import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from './server.js';
import { InfoStore, type FinTSLike, type ClientFactory } from './bank.js';
import { mapTransaction, checkAnswers } from './mapping.js';
import { loadConfig, type BridgeConfig } from './config.js';

const TOKEN = 'x'.repeat(40);
const cfg: BridgeConfig = {
  fintsUrl: 'https://bank.example/fints', blz: '72069155', user: 'nutzer', productId: 'TESTID', productVersion: '1.0',
  token: TOKEN, allowedOrigins: ['https://jghosting.github.io'], host: '127.0.0.1', port: 0, dataDir: ''
};
const auth = { authorization: `Bearer ${TOKEN}` };
const ok = { success: true, requiresTan: false, bankAnswers: [{ code: 20, text: 'OK' }], bankingInformationUpdated: false, dialogId: 'd' };

/** Nachgebaute Bank: PIN 9753, entkoppelte Freigabe beim Umsatzabruf (zweimal "noch nicht freigegeben"). */
function fakeBank(state: { pinSeen?: string; polls: number }): ClientFactory {
  return (_cfg, pin) => {
    state.pinSeen = pin;
    let selected: { id: number; name: string; isDecoupled: boolean } | undefined;
    const account = { accountNumber: '123456', bank: { country: 280, bankId: '72069155' }, iban: 'DE02720691550000123456', customerId: 'nutzer', accountType: 'CheckingAccount', currency: 'EUR', holder1: 'Max', product: 'Girokonto' };
    const client: FinTSLike = {
      config: {
        bankingInformation: { systemId: 'SYS1', bankMessages: [] } as never,
        availableTanMethods: [{ id: 910, name: 'chipTAN', isDecoupled: false, activeTanMedia: [], tanMediaRequirement: 0 }, { id: 946, name: 'SecureGo plus', isDecoupled: true, activeTanMedia: [], tanMediaRequirement: 0 }],
        get selectedTanMethod() { return selected; }
      },
      selectTanMethod(id) { selected = client.config.availableTanMethods.find(m => m.id === id); return selected; },
      selectTanMedia() { /* */ },
      async synchronize() {
        if (pin !== '9753') return { ...ok, success: false, bankAnswers: [{ code: 9942, text: 'PIN falsch' }] } as never;
        if (selected) (client.config.bankingInformation as { upd?: unknown }).upd = { version: 1, usage: 0, bankAccounts: [account] };
        return ok as never;
      },
      async synchronizeWithTan() { return ok as never; },
      async getAccountBalance() { return { ...ok, balance: { date: new Date(2026, 9, 8), currency: 'EUR', balance: 4280.5 } } as never; },
      async getAccountBalanceWithTan() { return ok as never; },
      async getAccountStatements() { return { ...ok, requiresTan: true, tanReference: 'REF1', tanChallenge: 'Bitte Umsatzabruf in SecureGo plus freigeben' } as never; },
      async getAccountStatementsWithTan(ref) {
        expect(ref).toBe('REF1');
        if (++state.polls < 2) return { ...ok, requiresTan: true, tanReference: 'REF1' } as never;
        return { ...ok, statements: [{ openingBalance: { date: new Date(), currency: 'EUR', value: 0 }, closingBalance: { date: new Date(), currency: 'EUR', value: 0 }, transactions: [
          { entryDate: new Date(2026, 9, 1), valueDate: new Date(2026, 9, 1), amount: -1100, remoteName: 'Hausverwaltung', remoteAccountNumber: 'DE89720500000000777001', purpose: 'Miete 10/2026', bookingText: 'DAUERAUFTRAG', fundsCode: '', transactionType: '', customerReference: 'NONREF', bankReference: '' },
          { entryDate: new Date(2025, 0, 1), valueDate: new Date(2025, 0, 1), amount: 5, purpose: 'außerhalb', fundsCode: '', transactionType: '', customerReference: '', bankReference: '' }
        ] }] } as never;
      }
    };
    return client;
  };
}

describe('FinTS-Brücke', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bridge-')); });

  it('verlangt den Zugangsschlüssel und setzt CORS nur für die eigene App', async () => {
    const app = buildServer({ ...cfg, dataDir: dir }, { factory: fakeBank({ polls: 0 }) });
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/health', headers: { authorization: 'Bearer falsch' } })).statusCode).toBe(401);
    const r = await app.inject({ url: '/api/health', headers: { ...auth, origin: 'https://jghosting.github.io' } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe('https://jghosting.github.io');
    const evil = await app.inject({ method: 'OPTIONS', url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('kompletter Abruf mit entkoppelter Freigabe; PIN wird nicht gespeichert', async () => {
    const state = { polls: 0 } as { pinSeen?: string; polls: number };
    const app = buildServer({ ...cfg, dataDir: dir }, { factory: fakeBank(state) });
    const open = await app.inject({ method: 'POST', url: '/api/fints/sessions', headers: auth, payload: { pin: '9753' } });
    expect(open.statusCode).toBe(200);
    const { sessionId } = open.json();
    expect(state.pinSeen).toBe('9753');

    const accounts = (await app.inject({ url: `/api/fints/sessions/${sessionId}/accounts`, headers: auth })).json();
    expect(accounts).toEqual([{ externalId: 'DE02720691550000123456', name: 'Girokonto', bankName: 'VR Bank', type: 'giro', iban: 'DE02720691550000123456', currency: 'EUR' }]);

    const bal = (await app.inject({ url: `/api/fints/sessions/${sessionId}/accounts/DE02720691550000123456/balance`, headers: auth })).json();
    expect(bal.balance).toBe(428050);

    const url = `/api/fints/sessions/${sessionId}/accounts/DE02720691550000123456/transactions?from=2025-10-08&to=2026-10-08`;
    const first = (await app.inject({ url, headers: auth })).json();
    expect(first.tan).toMatchObject({ decoupled: true, medium: 'SecureGo plus' });
    expect((await app.inject({ method: 'POST', url: `/api/fints/sessions/${sessionId}/tan`, headers: auth, payload: {} })).json()).toEqual({ pending: true });
    expect((await app.inject({ method: 'POST', url: `/api/fints/sessions/${sessionId}/tan`, headers: auth, payload: {} })).json()).toEqual({ ok: true });
    const txs = (await app.inject({ url, headers: auth })).json();
    expect(txs).toEqual([{ bookingDate: '2026-10-01', valueDate: '2026-10-01', amount: -110000, currency: 'EUR', counterpartyName: 'Hausverwaltung', counterpartyIban: 'DE89720500000000777001', purpose: 'Miete 10/2026', bookingText: 'DAUERAUFTRAG' }]);

    // Gespeichert wird nur die Banking Information – ohne PIN, mit Dateirechten 600
    const saved = readFileSync(join(dir, 'banking-info.json'), 'utf8');
    expect(saved).not.toContain('9753');
    expect(JSON.parse(saved).tanMethodId).toBe(946);
    expect(statSync(join(dir, 'banking-info.json')).mode & 0o777).toBe(0o600);

    expect((await app.inject({ method: 'DELETE', url: `/api/fints/sessions/${sessionId}`, headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/fints/sessions/${sessionId}/accounts`, headers: auth })).statusCode).toBe(410);
    await app.close();
  });

  it('falsche PIN → verständlicher Fehler, ohne PIN im Text', async () => {
    const app = buildServer({ ...cfg, dataDir: dir }, { factory: fakeBank({ polls: 0 }) });
    const r = await app.inject({ method: 'POST', url: '/api/fints/sessions', headers: auth, payload: { pin: 'geheim99' } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('auth');
    expect(r.body).not.toContain('geheim99');
    await app.close();
  });

  it('prüft den Zeitraum', async () => {
    const app = buildServer({ ...cfg, dataDir: dir }, { factory: fakeBank({ polls: 0 }) });
    const { sessionId } = (await app.inject({ method: 'POST', url: '/api/fints/sessions', headers: auth, payload: { pin: '9753' } })).json();
    expect((await app.inject({ url: `/api/fints/sessions/${sessionId}/accounts/X/transactions?from=gestern&to=heute`, headers: auth })).statusCode).toBe(400);
    await app.close();
  });
});

describe('Umwandlung & Konfiguration', () => {
  it('Beträge in Cent, keine unsinnigen IBANs', () => {
    const t = mapTransaction({ entryDate: new Date(2026, 0, 31), valueDate: new Date(2026, 1, 1), amount: -0.29, remoteAccountNumber: '0000123', purpose: '  REWE  Markt ', fundsCode: '', transactionType: '', customerReference: '', bankReference: '' } as never, 'EUR');
    expect(t).toEqual({ bookingDate: '2026-01-31', valueDate: '2026-02-01', amount: -29, currency: 'EUR', purpose: 'REWE Markt' });
  });
  it('Bankfehler werden klassifiziert', () => {
    expect(() => checkAnswers([{ code: 9942, text: 'PIN falsch' }])).toThrow('auth');
    expect(() => checkAnswers([{ code: 9050, text: 'Teilweise fehlerhaft' }])).toThrow('fints');
    expect(() => checkAnswers([{ code: 3076, text: 'Starke Kundenauthentifizierung nicht notwendig' }])).not.toThrow();
  });
  it('Konfiguration verlangt alle Werte und einen langen Schlüssel', () => {
    expect(() => loadConfig({})).toThrow(/FINTS_URL/);
    expect(() => loadConfig({ FINTS_URL: 'https://x', FINTS_BLZ: '1', FINTS_USER: 'u', FINTS_PRODUCT_ID: 'p', BRIDGE_TOKEN: 'kurz' })).toThrow(/zu kurz/);
    expect(loadConfig({ FINTS_URL: 'https://x', FINTS_BLZ: '1', FINTS_USER: 'u', FINTS_PRODUCT_ID: 'p', BRIDGE_TOKEN: TOKEN, ALLOWED_ORIGIN: 'https://a.io/, https://b.io' }).allowedOrigins).toEqual(['https://a.io', 'https://b.io']);
  });
});

/* ---------- Ende-zu-Ende: echter App-Client (FinTSProvider) gegen die Brücke ---------- */
import { createFinTSProvider } from '../../src/banking/fints/FinTSProvider.js';

describe('App ↔ Brücke', () => {
  it('Provider der App lädt Konten, Saldo und Umsätze inkl. SecureGo-Freigabe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-e2e-'));
    const app = buildServer({ ...cfg, dataDir: dir }, { factory: fakeBank({ polls: 0 }) });
    const addr = await app.listen({ host: '127.0.0.1', port: 0 });
    const provider = createFinTSProvider(async () => ({ url: addr, token: TOKEN }));
    const prompts: string[] = [];
    const session = await provider.open({
      askPin: async () => { prompts.push('pin'); return '9753'; },
      askTan: async c => { prompts.push(c.decoupled ? 'decoupled' : 'tan'); return new Promise(() => undefined); },
      closeTan: () => { prompts.push('close'); }
    });
    const accounts = await session.getAccounts();
    expect(accounts[0]?.externalId).toBe('DE02720691550000123456');
    expect((await session.getBalance(accounts[0]!.externalId)).balance).toBe(428050);
    const txs = await session.getTransactions(accounts[0]!.externalId, '2025-10-08', '2026-10-08');
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ amount: -110000, purpose: 'Miete 10/2026' });
    expect(prompts).toEqual(['pin', 'decoupled', 'close']);
    await session.close();
    await app.close();
  }, 20000);
});
