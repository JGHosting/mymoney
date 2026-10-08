# Meine Finanzen

Persönliche Finanz-App als PWA für das iPhone: Kontostand, Umsätze, Kategorien, Fixkosten, Abos, Budgets und Analysen.
Erste Bankanbindung: VR Bank über FinTS. Trade Republic ist vorbereitet, aber noch nicht umgesetzt.

- Alle Finanzdaten liegen **ausschließlich lokal auf dem Gerät** (IndexedDB über Dexie), wie bei Basislager.
- Im Repository liegen keine Daten und keine Schlüssel.
- Jeder Push auf `main` baut und veröffentlicht die App (GitHub Actions → Pages).
- Ohne Bank lässt sich alles mit realistischen Demo-Daten ausprobieren (12 Monate, mehrere hundert Umsätze).

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver
npm run check      # Typecheck + Lint + Tests + Build
npm run build      # Produktionsbuild nach dist/
npm run preview    # Build lokal ansehen
```

Node 22. Icons neu erzeugen: `node scripts/icons.mjs` (rendert `public/icons/icon.svg` mit Chromium).

## Installation auf dem iPhone

1. Die veröffentlichte Adresse in Safari öffnen.
2. Teilen → **Zum Home-Bildschirm**.
3. Die App startet danach im Vollbild, ohne Browserleiste, und funktioniert offline mit den bereits geladenen Daten.

## Architektur

```
UI (React)  ──useLiveQuery──▶  lokale Datenbank (IndexedDB/Dexie)
    │                                 ▲
    └── Sync-Service (src/data/sync.ts) ──┘
            │
            ▼
      BankingProvider (src/banking/types.ts)
        ├── MockBankingProvider  → Demo-Daten
        ├── FinTSProvider        → eigene FinTS-Brücke (server/) → VR Bank
        └── später: OpenBankingProvider → Trade Republic
```

Der Rest der App weiß nicht, wie eine Bank technisch angebunden ist. Ein neuer Anbieter wird nur in
`src/banking/registry.ts` ergänzt.

| Ordner | Inhalt |
|---|---|
| `src/core/` | Datenbank (`db.ts`), Datums- und Geldfunktionen (Beträge immer in ganzen Cent) |
| `src/domain/` | Reine Logik ohne UI: Kategorisierung, Duplikaterkennung, Monatsrechnung, Budgets, wiederkehrende Zahlungen, Hinweise |
| `src/data/` | Schreibende Abläufe: Sync, Import, Nutzeraktionen |
| `src/banking/` | Bank-Abstraktion, Demo-Bank, FinTS-Client |
| `src/backup/` | Backup/Import/Prüfroutine (aus Basislager übernommen) |
| `src/store/` | UI-Zustand (Zustand): Darstellung, Sync-Fortschritt, PIN/TAN-Abfrage |
| `src/ui/` | Seiten, Komponenten, Diagramme (eigene SVG-Diagramme, keine Chart-Bibliothek) |
| `server/` | FinTS-Brücke: Node/Fastify + lib-fints, Docker, Einrichtungsanleitung (`server/README.md`) |

### Technik

React 19, TypeScript (strict), Vite, Tailwind CSS 4, React Router (Hash-Routing für GitHub Pages), Zustand,
Dexie + `dexie-react-hooks`, Lucide-Icons, `vite-plugin-pwa`, Vitest.

Bewusste Abweichungen vom ursprünglichen Plan:

- **Kein Prisma/SQLite-Server.** Die Daten liegen wie bei Basislager auf dem Gerät. Das ist für eine persönliche App
  einfacher, günstiger und datensparsamer. Ein Server wird nur als zustandslose FinTS-Brücke gebraucht.
- **Kein TanStack Query.** Es gibt keine Server-Abfragen, die gecacht werden müssten; `useLiveQuery` aktualisiert die
  Oberfläche direkt bei jeder Datenbankänderung.
- **Keine Benutzer-Tabelle.** Ein Gerät = ein Nutzer.
- **Abos und wiederkehrende Zahlungen** liegen in einer Tabelle (`recurring`) mit den Kennzeichen `isSubscription` und `isFixedCost`.

## Datenmodell

Tabellen in `src/core/db.ts`: `accounts`, `transactions`, `categories`, `rules` (eigene Regeln), `budgets`,
`recurring`, `merchants` (eigene Händlernamen), `syncLog`, `settings`, `snapshots` (interne Sicherheitskopien).

Regeln für Schema-Änderungen (wie in Basislager):

1. Neue `this.version(n)` in `db.ts` anlegen, nie eine bestehende ändern.
2. Jede neue Tabelle in `BACKUP_TABLES` (`src/backup/backup.ts`) aufnehmen und `SCHEMA_VERSION` erhöhen.
3. In `migrate()` einen Schritt für ältere Backups ergänzen.
4. Die Backup-Prüfroutine (Mehr → Backup → Prüfroutine, und der Test in `src/data/data.test.ts`) muss grün sein.

## Sync

- **Erster Sync:** die letzten 12 Monate (einstellbar: 3/6/12/24).
- **Danach:** nur neue Umsätze seit dem letzten Sync, mit 14 Tagen Überlappung für nachträgliche Buchungen.
- **Duplikate:** Bank-ID, falls vorhanden; sonst Hash aus Konto, Buchungsdatum, Betrag, Gegenkonto und Verwendungszweck.
  Identische Umsätze am selben Tag werden durchnummeriert, damit echte Doppelzahlungen erhalten bleiben.
- Eigene Änderungen (Kategorie von Hand, Notiz, Händlername, Aufteilung, Ignorieren) überleben jeden Sync.

## VR Bank / FinTS

Die App spricht nie direkt mit der Bank, sondern über eine kleine **FinTS-Brücke** auf eigener Infrastruktur
(Raspberry Pi, Heimserver oder günstiger VPS). Der Grund: Browser dürfen den FinTS-Server der Bank nicht direkt
ansprechen (CORS), und die FinTS-Produkt-ID gehört nicht in ausgelieferten Code. Details und API-Vertrag: `server/README.md`.

Konfiguration der Brücke über Umgebungsvariablen (siehe `server/.env.example`): `FINTS_URL`, `FINTS_BLZ`, `FINTS_USER`,
`FINTS_PRODUCT_ID`, `BRIDGE_TOKEN`, `ALLOWED_ORIGIN`, `PORT`.

In der App: Mehr → Bankverbindung → Adresse und Zugangsschlüssel der Brücke eintragen → Verbinden.

## Sicherheit & Datenschutz

| Entscheidung | Umsetzung |
|---|---|
| Bank-PIN nie speichern | Wird bei jedem Sync abgefragt, nur im Formular gehalten und für genau einen Abruf übertragen. Nicht in IndexedDB, nicht in LocalStorage, nicht im Backup, nicht auf der Brücke. |
| Keine Secrets im Repository | `.env` ist in `.gitignore`; nur `server/.env.example` ohne Werte liegt im Repo. |
| Zugangsschlüssel der Brücke | Nur lokal in IndexedDB (`settings.fintsBridge`), ausdrücklich vom Backup ausgeschlossen (Test vorhanden). |
| Keine Zugangsdaten in Logs/Fehlern | Fehler werden in Klassen übersetzt (`BankError`), dem Nutzer nur verständliche Texte; das Sync-Protokoll enthält keine Eingaben. |
| HTTPS | GitHub Pages läuft nur über HTTPS; die Brücke wird ebenfalls nur per HTTPS erreichbar sein und `Authorization` sowie `Origin` prüfen. |
| Kein Tracking | Keine Analytics, keine Werbung, keine externen Schriften (Geist ist lokal gebündelt), keine Drittanbieter-SDKs. |
| Daten nur auf dem Gerät | Dauerhaften Speicher anfragen (`navigator.storage.persist`), regelmäßige Backups in iCloud Drive empfohlen. |

## Backup

Mehr → Backup & Export (gleiches Verfahren wie in Basislager):

- JSON-Backup über das iOS-Teilen-Menü (z. B. in iCloud Drive speichern)
- Import mit Vorschau, Prüfung und Migration; Zusammenführen oder Ersetzen in einer einzigen Transaktion
- automatische Sicherheitskopie vor jedem Import (die letzten 3)
- Prüfroutine: Export → Import in leere Testdatenbank → Export → Vergleich
- CSV-Export der Umsätze (Semikolon, deutsches Zahlenformat)

## Tests

`npm test` prüft Kategorisierung, Duplikaterkennung, Monatsrechnung, Budgets, Sparquote, wiederkehrende Zahlungen,
Aggregationen sowie den kompletten Sync mit der Demo-Bank (inkl. zweitem Sync ohne Doppelimport) und den
Backup-Rundlauf.

## Phasen

- [x] 1 Analyse & Architektur
- [x] 2 Oberfläche mit Demo-Daten
- [x] 3 Datenmodell
- [x] 4 Demo-Bank (MockBankingProvider)
- [x] 5a FinTS-Brücke (getestet gegen nachgebaute Bank)
- [ ] 5b Erster echter Abruf bei der VR Bank (wartet auf die FinTS-Registrierungsnummer)
- [ ] 6 Feinschliff auf dem iPhone
