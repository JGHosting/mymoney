# FinTS-Brücke

Kleiner, zustandsloser Dienst (Node.js, TypeScript, Fastify, [lib-fints](https://github.com/robocode13/lib-fints)),
der zwischen der App und dem FinTS-Server der VR Bank vermittelt.

```
iPhone-App ──HTTPS + Zugangsschlüssel──▶ Brücke (dein Server) ──FinTS 3.0 PIN/TAN──▶ VR Bank (Atruvia)
```

**Warum ein Server?** Safari darf nicht direkt mit dem FinTS-Server der Bank sprechen (kein CORS), und die
FinTS-Registrierungsnummer gehört nicht in öffentlich ausgelieferten Code.

**Was die Brücke speichert:** nichts außer der „Banking Information“ der Bank (Bankparameter, Kontenliste, System-ID),
damit die Bank die Brücke wiedererkennt. **Keine PIN, keine TAN, keine Umsätze.** Wo diese Information liegt, regelt `STATE_STORAGE`:

| `STATE_STORAGE` | Ablage | Für |
|---|---|---|
| `client` | verschlüsselt (AES-256-GCM) in der App; die Brücke selbst ist komplett zustandslos | Cloud Run und andere Plattformen ohne Festplatte |
| `file` (Standard) | `/data/banking-info.json` (Rechte 600) | eigener Server |

Die PIN kommt bei jedem Abruf aus der App, liegt nur im Arbeitsspeicher und verfällt mit der Sitzung (spätestens nach 10 Minuten).

---

## Einrichtung

Du brauchst: die **Registrierungsnummer** (FinTS-Produktregistrierung), deine **BLZ**, deinen **VR-NetKey/Alias**
und **VR SecureGo plus** als TAN-Verfahren.

### Variante A – Google Cloud Run (empfohlen, praktisch kostenlos)

Kein eigenes Gerät, kein VPN, HTTPS automatisch unter `https://mymoney-bridge-….europe-west3.run.app`.
Die Brücke läuft nur, wenn die App sie aufruft (0–1 Instanzen) – das liegt weit im Gratiskontingent von Cloud Run.
Betriebssystem, TLS und Zertifikate pflegt Google; das Node-Image baut GitHub Actions monatlich neu.

1. **Google-Cloud-Konto** unter [console.cloud.google.com](https://console.cloud.google.com) anlegen. Google verlangt dafür
   eine Kreditkarte (nur zur Prüfung). Ein neues Projekt anlegen, z. B. `mymoney`.
2. Oben rechts **Cloud Shell** öffnen (Terminal im Browser) und ausführen:
   ```bash
   gcloud config set project <PROJEKT-ID>
   git clone https://github.com/JGHosting/mymoney.git && cd mymoney/server/deploy
   bash cloudrun-setup.sh
   ```
   Das Skript fragt BLZ, VR-NetKey und Registrierungsnummer ab und legt sie im **Secret Manager** ab (nie im Repo, nie in der App).
   Es erzeugt den Zugangsschlüssel und zeigt ihn **einmal** an.
3. Die drei ausgegebenen Werte in GitHub eintragen: *Settings → Secrets and variables → Actions → Variables*
   (`GCP_PROJECT`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`). Es sind keine Geheimnisse; GitHub bekommt keinen Schlüssel,
   sondern meldet sich über Workload Identity Federation an (nur Pushes auf `main` dieses Repos).
4. *Actions → Bridge Cloud Run → Run workflow.* Danach stellt jeder Push in `server/` automatisch bereit.

Optional: eine abweichende FinTS-Adresse als Repo-Variable `FINTS_URL` setzen.
Zugangsschlüssel erneuern: `bash cloudrun-setup.sh --rotate-token` (danach in der App eintragen).

### Variante B – eigener Server (VPS oder Mini-PC zu Hause)

Für später, z. B. mit einem sparsamen Mini-PC. Mit eigener Domain oder kostenloser Subdomain
(z. B. [DuckDNS](https://www.duckdns.org)); Caddy holt das HTTPS-Zertifikat automatisch.

```bash
curl -fsSL https://get.docker.com | sh
git clone https://github.com/JGHosting/mymoney.git && cd mymoney/server
cp .env.example .env && chmod 600 .env
openssl rand -hex 32            # als BRIDGE_TOKEN eintragen
nano .env                       # FINTS_BLZ, FINTS_USER, FINTS_PRODUCT_ID, BRIDGE_TOKEN, DOMAIN
docker compose --profile https up -d --build
```

Firewall: nur 80 und 443 öffentlich, SSH nur mit Schlüssel (oder nur über Tailscale). Zu Hause zusätzlich
Portweiterleitung 80/443 am Router. Updates: `git pull && docker compose --profile https up -d --build`.

### In der App verbinden

1. Mehr → Bankverbindung → **Adresse der FinTS-Brücke** und **Zugangsschlüssel** (BRIDGE_TOKEN) eintragen → Speichern.
2. **Verbindung testen** → „Brücke erreichbar“.
3. **Verbinden & synchronisieren** → PIN eingeben → in **SecureGo plus** freigeben.
   Für Umsätze älter als 90 Tage verlangt die Bank meist eine zweite Freigabe.
4. Danach Demo-Daten entfernen und ein Backup machen.

---

## Fehlersuche

| Meldung in der App | Ursache / Lösung |
|---|---|
| „Die Bankverbindung ist noch nicht eingerichtet.“ | Adresse oder Zugangsschlüssel falsch → in der App prüfen. |
| „Die Anmeldung bei deiner Bank konnte nicht abgeschlossen werden.“ | PIN oder Anmeldename falsch. **Nicht mehrfach probieren** – sonst sperrt die Bank den Zugang. |
| „Die Bankverbindung konnte nicht hergestellt werden.“ | Details im Sync-Protokoll (Mehr → Bankverbindung). Typisch kurz nach der Registrierung: Produkt noch nicht bei der Bank freigeschaltet (dauert bis zu einigen Wochen). |
| „Die Bank ist momentan nicht erreichbar.“ | FINTS_URL prüfen (FinTS-Bankenliste) oder später erneut versuchen. |

Mehr Details: Cloud Run → *mymoney-bridge* → Logs (Variante A) bzw. `docker compose logs -f bridge` (Variante B).
Inhalte von Anfragen (PIN/TAN) werden nie protokolliert.

---

## API-Vertrag

Umgesetzt in der App unter `src/banking/fints/FinTSProvider.ts`. Jede Anfrage trägt `Authorization: Bearer <BRIDGE_TOKEN>`.

| Methode | Pfad | Body / Query | Antwort |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok: true }` |
| POST | `/api/fints/sessions` | `{ pin, state? }` | `{ sessionId }` oder `{ sessionId, tan: { text, decoupled, medium? } }` |
| POST | `/api/fints/sessions/:id/tan` | `{ tan? }` (leer = Freigabe abfragen) | `{ ok: true }` oder `{ pending: true }` |
| GET | `/api/fints/sessions/:id/accounts` | – | `BankAccountData[]` |
| GET | `/api/fints/sessions/:id/accounts/:iban/balance` | – | `{ balance, at }` oder `{ tan }` |
| GET | `/api/fints/sessions/:id/accounts/:iban/transactions` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` | `BankTransactionData[]` oder `{ tan }` |
| DELETE | `/api/fints/sessions/:id` | – | `{ ok: true, state? }` (bei `STATE_STORAGE=client`, wenn sich der Zustand geändert hat) |

Fehler: HTTP 4xx/5xx mit `{ error: 'unreachable' | 'auth' | 'fints' | 'config' | 'other', detail? }`.

## Entwicklung

```bash
npm install
npm test          # u. a. kompletter Abruf App ↔ Brücke gegen eine nachgebaute Bank (inkl. SecureGo-Freigabe)
npm run dev       # mit .env im Ordner
```

Sicherheit im Überblick: Zugangsschlüssel (≥ 32 Zeichen, Vergleich in konstanter Zeit, Sperre nach 10 Fehlversuchen),
CORS nur für `ALLOWED_ORIGIN`, HTTPS immer (Cloud Run bzw. Caddy), Port auf eigenem Server nur lokal gebunden,
Container ohne Root-Rechte, `debugEnabled` von lib-fints ist fest aus.
