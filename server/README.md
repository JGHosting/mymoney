# FinTS-Brücke (Phase 5)

Kleiner, zustandsloser Node.js-Dienst (TypeScript, Fastify), der zwischen der App und dem FinTS-Server der VR Bank vermittelt.

**Warum überhaupt ein Server?** Browser dürfen nicht direkt mit dem FinTS-Server der Bank sprechen (kein CORS),
und die FinTS-Produkt-ID gehört nicht in öffentlich ausgelieferten Code.

**Was die Brücke nicht tut:** Sie speichert keine Umsätze, keine PIN und keine Sitzungen über die Dauer eines Abrufs hinaus.
Alle Finanzdaten landen ausschließlich in der App auf dem iPhone.

## API-Vertrag

Bereits in der App umgesetzt (`src/banking/fints/FinTSProvider.ts`). Jede Anfrage trägt `Authorization: Bearer <BRIDGE_TOKEN>`.

| Methode | Pfad | Body / Query | Antwort |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok: true }` |
| POST | `/api/fints/sessions` | `{ pin }` | `{ sessionId }` oder `{ sessionId, tan: { text, decoupled, medium? } }` |
| POST | `/api/fints/sessions/:id/tan` | `{ tan? }` (leer = Freigabe abfragen) | `{ ok: true }` oder `{ pending: true }` |
| GET | `/api/fints/sessions/:id/accounts` | – | `BankAccountData[]` |
| GET | `/api/fints/sessions/:id/accounts/:iban/balance` | – | `{ balance, at }` (Cent, ms) |
| GET | `/api/fints/sessions/:id/accounts/:iban/transactions` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` | `BankTransactionData[]` oder `{ tan }` |
| DELETE | `/api/fints/sessions/:id` | – | `{ ok: true }` |

Fehler: HTTP 4xx/5xx mit `{ error: 'unreachable' | 'auth' | 'fints' | 'config' | 'other', detail? }`.
`detail` darf niemals PIN, TAN oder Zugangsdaten enthalten.

## Konfiguration

Siehe `../.env.example`. Voraussetzung ist eine **FinTS-Produktregistrierung** (kostenlos, Antrag über fints.org);
ohne Produkt-ID lehnen die Banken Anfragen ab.

## Status

Noch nicht implementiert. Vor der Umsetzung wird die FinTS-Bibliothek geprüft (aktuelle FinTS-3.0-Unterstützung,
PSD2/SCA mit decoupled TAN für VR SecureGo plus, Umsatzabruf HKKAZ/HKCAZ, Saldo HKSAL).
