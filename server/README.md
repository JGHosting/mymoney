# FinTS-Brücke

Kleiner, zustandsloser Dienst (Node.js, TypeScript, Fastify, [lib-fints](https://github.com/robocode13/lib-fints)),
der zwischen der App und dem FinTS-Server der VR Bank vermittelt.

```
iPhone-App ──HTTPS + Zugangsschlüssel──▶ Brücke (dein Server) ──FinTS 3.0 PIN/TAN──▶ VR Bank (Atruvia)
```

**Warum ein Server?** Safari darf nicht direkt mit dem FinTS-Server der Bank sprechen (kein CORS), und die
FinTS-Registrierungsnummer gehört nicht in öffentlich ausgelieferten Code.

**Was die Brücke speichert:** nur die „Banking Information“ der Bank (Bankparameter, Kontenliste, System-ID) in
`/data/banking-info.json` (Rechte 600), damit die Bank die Brücke wiedererkennt. **Keine PIN, keine TAN, keine Umsätze.**
Die PIN kommt bei jedem Abruf aus der App, liegt nur im Arbeitsspeicher und verfällt mit der Sitzung (spätestens nach 10 Minuten).

---

## Einrichtung

Du brauchst: die **Registrierungsnummer** (FinTS-Produktregistrierung), deine **BLZ**, deinen **VR-NetKey/Alias**
und **VR SecureGo plus** als TAN-Verfahren.

### Variante A – VPS mit eigener Domain (empfohlen)

Läuft immer, von überall erreichbar. Z. B. Hetzner Cloud (kleinster Server, Ubuntu 24.04, ca. 4–5 €/Monat).

1. **Domain:** Eine eigene Domain oder kostenlos eine Subdomain bei [DuckDNS](https://www.duckdns.org)
   (z. B. `jakob-finanzen.duckdns.org`) auf die IP des Servers zeigen lassen.
2. **Docker installieren** (auf dem Server):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. **Code holen:**
   ```bash
   git clone https://github.com/JGHosting/mymoney.git
   cd mymoney/server
   ```
4. **Konfiguration:**
   ```bash
   cp .env.example .env
   openssl rand -hex 32        # Ausgabe als BRIDGE_TOKEN eintragen
   nano .env                   # FINTS_BLZ, FINTS_USER, FINTS_PRODUCT_ID, BRIDGE_TOKEN, DOMAIN ausfüllen
   chmod 600 .env
   ```
5. **Starten** (Caddy holt das HTTPS-Zertifikat automatisch):
   ```bash
   docker compose --profile https up -d --build
   ```
6. **Firewall:** nur Ports 22, 80 und 443 offen lassen (Hetzner-Firewall oder `ufw`).

Adresse für die App: `https://<DOMAIN>`

### Variante B – Raspberry Pi / Rechner zu Hause + Tailscale

Kostenlos, nichts ist öffentlich im Internet. Das iPhone braucht dafür die Tailscale-App (eingeschaltet beim Sync).

1. Docker installieren (`curl -fsSL https://get.docker.com | sh`) und [Tailscale](https://tailscale.com/download) auf
   Pi **und** iPhone mit demselben Konto einrichten. In der Tailscale-Verwaltung unter *DNS* **HTTPS-Zertifikate** aktivieren.
2. Schritte 3 und 4 wie oben (DOMAIN leer lassen).
3. Starten und per Tailscale mit HTTPS bereitstellen:
   ```bash
   docker compose up -d --build
   sudo tailscale serve --bg 8787
   ```

Adresse für die App: `https://<pi-name>.<tailnet>.ts.net` (zeigt `tailscale serve status`).

### In der App verbinden

1. Mehr → Bankverbindung → **Adresse der FinTS-Brücke** und **Zugangsschlüssel** (BRIDGE_TOKEN) eintragen → Speichern.
2. **Verbindung testen** → „Brücke erreichbar“.
3. **Verbinden & synchronisieren** → PIN eingeben → in **SecureGo plus** freigeben.
   Für Umsätze älter als 90 Tage verlangt die Bank meist eine zweite Freigabe.
4. Danach Demo-Daten entfernen und ein Backup machen.

### Aktualisieren

```bash
cd mymoney && git pull && cd server
docker compose --profile https up -d --build     # Variante B ohne --profile https
```

---

## Fehlersuche

| Meldung in der App | Ursache / Lösung |
|---|---|
| „Die Bankverbindung ist noch nicht eingerichtet.“ | Adresse oder Zugangsschlüssel falsch → in der App prüfen (`docker compose logs bridge`). |
| „Die Anmeldung bei deiner Bank konnte nicht abgeschlossen werden.“ | PIN oder Anmeldename falsch. **Nicht mehrfach probieren** – sonst sperrt die Bank den Zugang. |
| „Die Bankverbindung konnte nicht hergestellt werden.“ | Details im Sync-Protokoll (Mehr → Bankverbindung). Typisch kurz nach der Registrierung: Produkt noch nicht bei der Bank freigeschaltet (dauert bis zu einigen Wochen). |
| „Die Bank ist momentan nicht erreichbar.“ | FINTS_URL prüfen (FinTS-Bankenliste) oder später erneut versuchen. |

Mehr Details: `docker compose logs -f bridge`. Inhalte von Anfragen (PIN/TAN) werden nie protokolliert.

---

## API-Vertrag

Umgesetzt in der App unter `src/banking/fints/FinTSProvider.ts`. Jede Anfrage trägt `Authorization: Bearer <BRIDGE_TOKEN>`.

| Methode | Pfad | Body / Query | Antwort |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok: true }` |
| POST | `/api/fints/sessions` | `{ pin }` | `{ sessionId }` oder `{ sessionId, tan: { text, decoupled, medium? } }` |
| POST | `/api/fints/sessions/:id/tan` | `{ tan? }` (leer = Freigabe abfragen) | `{ ok: true }` oder `{ pending: true }` |
| GET | `/api/fints/sessions/:id/accounts` | – | `BankAccountData[]` |
| GET | `/api/fints/sessions/:id/accounts/:iban/balance` | – | `{ balance, at }` oder `{ tan }` |
| GET | `/api/fints/sessions/:id/accounts/:iban/transactions` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` | `BankTransactionData[]` oder `{ tan }` |
| DELETE | `/api/fints/sessions/:id` | – | `{ ok: true }` |

Fehler: HTTP 4xx/5xx mit `{ error: 'unreachable' | 'auth' | 'fints' | 'config' | 'other', detail? }`.

## Entwicklung

```bash
npm install
npm test          # u. a. kompletter Abruf App ↔ Brücke gegen eine nachgebaute Bank (inkl. SecureGo-Freigabe)
npm run dev       # mit .env im Ordner
```

Sicherheit im Überblick: Zugangsschlüssel (≥ 32 Zeichen, Vergleich in konstanter Zeit, Sperre nach 10 Fehlversuchen),
CORS nur für `ALLOWED_ORIGIN`, Port nur lokal gebunden (nach außen nur über Caddy/Tailscale mit HTTPS),
Container ohne Root-Rechte, `debugEnabled` von lib-fints ist fest aus.
