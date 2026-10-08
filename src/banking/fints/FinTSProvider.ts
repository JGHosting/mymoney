/**
 * VR Bank über FinTS/HBCI.
 *
 * Browser dürfen nicht direkt mit dem FinTS-Server der Bank sprechen (kein CORS, und die
 * FinTS-Produkt-ID gehört nicht in öffentlichen Code). Deshalb läuft die Bankkommunikation über eine
 * kleine, zustandslose "FinTS-Brücke" auf eigener Infrastruktur (server/, Phase 5):
 *
 *   App ──HTTPS──▶ FinTS-Brücke (eigener Rechner/VPS) ──FinTS 3.0──▶ VR Bank (Atruvia)
 *
 * - Die Brücke speichert keine Umsätze und keine PIN. Sie reicht nur durch.
 * - Die PIN wird bei jedem Sync abgefragt und nur für diesen einen Abruf übertragen.
 * - Die Brücke ist mit einem eigenen Zugangsschlüssel geschützt (nicht im Backup, nicht im Repo).
 * - Bankleitzahl, Anmeldename und FinTS-URL liegen in der .env der Brücke (FINTS_BLZ, FINTS_USER, FINTS_URL).
 *
 * API-Vertrag der Brücke (JSON):
 *   POST   /api/fints/sessions              { pin }            → { sessionId } | { sessionId, tan: TanChallenge }
 *   POST   /api/fints/sessions/:id/tan      { tan? }           → { ok: true } | { pending: true }
 *   GET    /api/fints/sessions/:id/accounts                    → BankAccountData[]
 *   GET    /api/fints/sessions/:id/accounts/:ext/balance       → BankBalance
 *   GET    /api/fints/sessions/:id/accounts/:ext/transactions?from&to  → BankTransactionData[] | { tan }
 *   DELETE /api/fints/sessions/:id
 * Fehler: { error: BankErrorKind, detail? } mit HTTP 4xx/5xx.
 */
import type { BankAccountData, BankBalance, BankingProvider, BankTransactionData, ProviderSession, SyncPrompter, TanChallenge } from '../types';
import { BankError, type BankErrorKind } from '../types';

export interface BridgeConfig { url: string; token: string }

const DECOUPLED_POLL_MS = 2500;
const DECOUPLED_TIMEOUT_MS = 5 * 60 * 1000;

export function createFinTSProvider(getConfig: () => Promise<BridgeConfig | undefined>): BankingProvider {
  return {
    id: 'fints',
    label: 'VR Bank (FinTS)',
    async open(prompter: SyncPrompter): Promise<ProviderSession> {
      const cfg = await getConfig();
      if (!cfg?.url || !cfg.token) throw new BankError('config');
      const base = cfg.url.replace(/\/+$/, '');
      const call = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
        let res: Response;
        try {
          res = await fetch(base + path, {
            method,
            headers: { Authorization: `Bearer ${cfg.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
            body: body !== undefined ? JSON.stringify(body) : undefined
          });
        } catch {
          throw new BankError('unreachable');
        }
        const data = (await res.json().catch(() => ({}))) as T & { error?: BankErrorKind; detail?: string };
        if (!res.ok) throw new BankError(data.error ?? (res.status === 401 ? 'config' : 'fints'), undefined, data.detail);
        return data;
      };

      const pin = await prompter.askPin('VR Bank');
      if (pin == null) throw new BankError('cancelled');
      const start = await call<{ sessionId: string; tan?: TanChallenge }>('POST', '/api/fints/sessions', { pin });
      const sid = encodeURIComponent(start.sessionId);

      /** TAN-Schritt: Eingabe (chipTAN) oder Warten auf Freigabe in der SecureGo-plus-App. */
      const handleTan = async (tan: TanChallenge) => {
        if (!tan.decoupled) {
          const value = await prompter.askTan(tan);
          if (value == null) throw new BankError('cancelled');
          await call('POST', `/api/fints/sessions/${sid}/tan`, { tan: value });
          return;
        }
        let cancelled = false;
        void prompter.askTan(tan).then(v => { if (v == null) cancelled = true; });
        const until = Date.now() + DECOUPLED_TIMEOUT_MS;
        try {
          while (Date.now() < until) {
            if (cancelled) throw new BankError('cancelled');
            const r = await call<{ ok?: boolean; pending?: boolean }>('POST', `/api/fints/sessions/${sid}/tan`, {});
            if (r.ok) return;
            await new Promise(res => setTimeout(res, DECOUPLED_POLL_MS));
          }
          throw new BankError('auth', 'Die Freigabe wurde nicht rechtzeitig bestätigt.');
        } finally { prompter.closeTan(); }
      };
      if (start.tan) await handleTan(start.tan);

      return {
        getAccounts: () => call<BankAccountData[]>('GET', `/api/fints/sessions/${sid}/accounts`),
        getBalance: (ext: string) => call<BankBalance>('GET', `/api/fints/sessions/${sid}/accounts/${encodeURIComponent(ext)}/balance`),
        async getTransactions(ext: string, from: string, to: string) {
          const path = `/api/fints/sessions/${sid}/accounts/${encodeURIComponent(ext)}/transactions?from=${from}&to=${to}`;
          // Umsatzabruf älter als 90 Tage verlangt bei PSD2 oft eine zusätzliche TAN
          let r = await call<BankTransactionData[] | { tan: TanChallenge }>('GET', path);
          if (!Array.isArray(r)) { await handleTan(r.tan); r = await call<BankTransactionData[]>('GET', path); }
          return r as BankTransactionData[];
        },
        async close() { await call('DELETE', `/api/fints/sessions/${sid}`).catch(() => undefined); }
      };
    }
  };
}
