#!/usr/bin/env bash
# Einmalige Einrichtung der FinTS-Brücke auf Google Cloud Run (Region Frankfurt).
#
# Ausführen in der Google Cloud Shell (Browser, nichts installieren):
#   git clone https://github.com/JGHosting/mymoney.git && cd mymoney/server/deploy
#   bash cloudrun-setup.sh
#
# Das Skript ist wiederholbar: Vorhandenes bleibt unverändert, Fehlendes wird ergänzt.
# Es legt an:
#   - Dienstkonto "mymoney-bridge"   – mit ihm läuft die Brücke; darf nur ihre vier Geheimnisse lesen
#   - Secret Manager: fints-blz, fints-user, fints-product-id, bridge-token
#   - Artifact Registry "mymoney"    – Images, nur die letzten 3 bleiben erhalten
#   - Cloud-Run-Dienst "mymoney-bridge" (min. 0, max. 1 Instanz → kostet im Ruhezustand nichts)
#   - Zugang für GitHub Actions ohne Schlüsseldatei (Workload Identity Federation),
#     beschränkt auf den main-Branch von JGHosting/mymoney
#   - Budget-Warnung bei 1 € (nur Benachrichtigung, keine Kappung)
#
# Optionen:  --rotate-token  neuen Zugangsschlüssel erzeugen (danach in der App neu eintragen)
set -euo pipefail

REGION="${REGION:-europe-west3}"
SERVICE="mymoney-bridge"
REPO="mymoney"
GITHUB_REPO="JGHosting/mymoney"
POOL="github"
PROVIDER="mymoney"
ROTATE=0
[[ "${1:-}" == "--rotate-token" ]] && ROTATE=1

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "$PROJECT" ]]; then
  echo "Kein Projekt gewählt. Zuerst:  gcloud config set project <PROJEKT-ID>" >&2
  exit 1
fi
NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUNTIME_SA="${SERVICE}@${PROJECT}.iam.gserviceaccount.com"
DEPLOY_SA="mymoney-deployer@${PROJECT}.iam.gserviceaccount.com"
echo "Projekt: $PROJECT ($NUM), Region: $REGION"

say "Schnittstellen aktivieren"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com \
  --project "$PROJECT"
ok "aktiv"

say "Dienstkonten"
for sa in "$SERVICE:FinTS-Brücke (Laufzeit)" "mymoney-deployer:GitHub Actions (Bereitstellung)"; do
  name="${sa%%:*}"
  if gcloud iam service-accounts describe "${name}@${PROJECT}.iam.gserviceaccount.com" --project "$PROJECT" >/dev/null 2>&1; then
    ok "$name vorhanden"
  else
    gcloud iam service-accounts create "$name" --display-name "${sa#*:}" --project "$PROJECT"
    ok "$name angelegt"
  fi
done

say "Geheimnisse (Secret Manager)"
put_secret() { # name wert
  printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- --project "$PROJECT" >/dev/null
}
ensure_secret() { # name frage [verdeckt]
  local name="$1" value=""
  if gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then ok "$name vorhanden"; return; fi
  while [[ -z "$value" ]]; do
    if [[ "${3:-}" == "verdeckt" ]]; then read -rsp "  $2: " value; echo; else read -rp "  $2: " value; fi
    value="$(printf '%s' "$value" | tr -d '[:space:]')"
  done
  gcloud secrets create "$name" --replication-policy=user-managed --locations="$REGION" --project "$PROJECT" >/dev/null
  put_secret "$name" "$value"
  ok "$name gespeichert"
}
ensure_secret fints-blz "Bankleitzahl deiner VR Bank"
ensure_secret fints-user "VR-NetKey oder Alias (Anmeldename im Online-Banking)"
ensure_secret fints-product-id "FinTS-Registrierungsnummer" verdeckt

NEW_TOKEN=""
if ! gcloud secrets describe bridge-token --project "$PROJECT" >/dev/null 2>&1; then
  gcloud secrets create bridge-token --replication-policy=user-managed --locations="$REGION" --project "$PROJECT" >/dev/null
  NEW_TOKEN="$(openssl rand -hex 32)"; put_secret bridge-token "$NEW_TOKEN"; ok "bridge-token erzeugt"
elif (( ROTATE )); then
  NEW_TOKEN="$(openssl rand -hex 32)"; put_secret bridge-token "$NEW_TOKEN"; ok "bridge-token erneuert"
  # Alte Versionen deaktivieren, damit nur der neue Schlüssel gilt und das Gratiskontingent (6 Versionen) reicht
  for v in $(gcloud secrets versions list bridge-token --filter='state=ENABLED' --format='value(name)' --sort-by=~createTime --project "$PROJECT" | tail -n +2); do
    gcloud secrets versions destroy "$v" --secret bridge-token --quiet --project "$PROJECT" >/dev/null
  done
else
  ok "bridge-token vorhanden"
fi
for s in fints-blz fints-user fints-product-id bridge-token; do
  gcloud secrets add-iam-policy-binding "$s" --member "serviceAccount:$RUNTIME_SA" \
    --role roles/secretmanager.secretAccessor --project "$PROJECT" --condition=None >/dev/null
done
ok "nur das Dienstkonto der Brücke darf die Geheimnisse lesen"

say "Image-Ablage (Artifact Registry)"
if ! gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location "$REGION" \
    --description "MyMoney FinTS-Brücke" --project "$PROJECT"
fi
policy="$(mktemp)"
cat >"$policy" <<'JSON'
[
  {"name": "behalte-letzte-3", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 3}},
  {"name": "loesche-alte", "action": {"type": "Delete"}, "condition": {"olderThan": "7d"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies "$REPO" --location "$REGION" --policy "$policy" \
  --no-dry-run --project "$PROJECT" >/dev/null
rm -f "$policy"
gcloud artifacts repositories add-iam-policy-binding "$REPO" --location "$REGION" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/artifactregistry.writer --project "$PROJECT" >/dev/null
ok "$REGION-docker.pkg.dev/$PROJECT/$REPO (alte Images werden automatisch gelöscht)"

say "Cloud-Run-Dienst"
if gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  ok "$SERVICE vorhanden"
else
  # Platzhalter; das echte Image spielt danach GitHub Actions ein
  gcloud run deploy "$SERVICE" --image us-docker.pkg.dev/cloudrun/container/hello --region "$REGION" \
    --service-account "$RUNTIME_SA" --allow-unauthenticated --min-instances 0 --max-instances 1 \
    --project "$PROJECT" --quiet >/dev/null
  ok "$SERVICE angelegt (Platzhalter bis zur ersten Bereitstellung)"
fi
# Öffentlich erreichbar – geschützt wird die Brücke durch ihren eigenen Zugangsschlüssel (die App kann kein Google-Login)
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" --member allUsers \
  --role roles/run.invoker --project "$PROJECT" >/dev/null
URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"

say "GitHub Actions ohne Schlüsseldatei (Workload Identity Federation)"
if ! gcloud iam workload-identity-pools describe "$POOL" --location global --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location global --display-name "GitHub Actions" --project "$PROJECT"
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool "$POOL" --location global --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool "$POOL" --location global \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository=='${GITHUB_REPO}' && assertion.ref=='refs/heads/main'" \
    --project "$PROJECT"
fi
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${NUM}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" \
  --project "$PROJECT" >/dev/null
# Bereitstellen darf es nur diesen einen Dienst, und nur mit dem Dienstkonto der Brücke
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" --member "serviceAccount:$DEPLOY_SA" \
  --role roles/run.developer --project "$PROJECT" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member "serviceAccount:$DEPLOY_SA" \
  --role roles/iam.serviceAccountUser --project "$PROJECT" >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$DEPLOY_SA" \
  --role roles/serviceusage.serviceUsageConsumer --condition=None >/dev/null
ok "nur Pushes auf main von $GITHUB_REPO dürfen bereitstellen"

say "Budget-Warnung (1 €)"
BILLING="$(gcloud billing projects describe "$PROJECT" --format='value(billingAccountName)' --quiet 2>/dev/null </dev/null | sed 's#billingAccounts/##' || true)"
if [[ -z "$BILLING" ]]; then
  warn "Kein Rechnungskonto gefunden – Budget bitte in der Konsole anlegen (Abrechnung → Budgets & Benachrichtigungen)."
elif gcloud billing budgets list --billing-account "$BILLING" --format='value(displayName)' --quiet 2>/dev/null </dev/null | grep -qx "MyMoney"; then
  ok "vorhanden"
else
  if gcloud billing budgets create --billing-account "$BILLING" --display-name "MyMoney" \
       --budget-amount 1EUR --filter-projects "projects/$PROJECT" \
       --threshold-rule percent=0.5 --threshold-rule percent=1.0 --quiet >/dev/null 2>&1 </dev/null; then
    ok "E-Mail bei 0,50 € und 1 €"
  else
    warn "Budget konnte nicht angelegt werden – bitte in der Konsole: Abrechnung → Budgets & Benachrichtigungen → 1 €."
  fi
fi

cat <<EOF

────────────────────────────────────────────────────────────────────
Fertig. Jetzt in GitHub eintragen:
  github.com/${GITHUB_REPO} → Settings → Secrets and variables → Actions → Variables → New variable

  GCP_PROJECT       ${PROJECT}
  GCP_WIF_PROVIDER  projects/${NUM}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}
  GCP_DEPLOY_SA     ${DEPLOY_SA}

Danach unter Actions → "Bridge Cloud Run" → Run workflow (erste Bereitstellung, ca. 2 Minuten).

In der App (Mehr → Bankverbindung):
  Adresse            ${URL}
EOF
if [[ -n "$NEW_TOKEN" ]]; then
  echo "  Zugangsschlüssel  ${NEW_TOKEN}"
  echo "  (wird nur jetzt angezeigt; später:  gcloud secrets versions access latest --secret bridge-token)"
else
  echo "  Zugangsschlüssel  gcloud secrets versions access latest --secret bridge-token"
fi
echo "────────────────────────────────────────────────────────────────────"
