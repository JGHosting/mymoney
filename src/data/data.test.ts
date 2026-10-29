import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { MyMoneyDB } from '../core/db';
import { runSync, setActiveProviders, getSyncState, removeProviderData } from './sync';
import { setCategory, renameMerchant, setNote } from './actions';
import { runRoundtripTest, exportBackup, checkBackup, importBackup } from '../backup/backup';
import { setProvider } from '../banking/registry';
import { createMockProvider } from '../banking/mock/MockBankingProvider';
import { setSetting } from '../core/db';
import { importTransactions, loadContext } from './importer';

setProvider(createMockProvider(0));
const prompter = { askPin: async () => null, askTan: async () => null, closeTan: () => undefined };

async function freshDb(name: string) {
  const d = new MyMoneyDB(name);
  await d.open();
  return d;
}

describe('Sync mit Demo-Bank', () => {
  it('lädt 12 Monate, erkennt Fixkosten und importiert beim zweiten Sync nichts doppelt', async () => {
    const d = await freshDb('t-sync');
    await setActiveProviders(['mock'], d);
    const steps: string[] = [];
    const r1 = await runSync('mock', prompter, s => steps.push(s), d);
    expect(steps).toEqual(['connect', 'accounts', 'transactions', 'process', 'categories', 'done']);
    expect(r1.accounts).toBe(2);
    expect(r1.added).toBeGreaterThan(300);
    const count1 = await d.transactions.count();
    expect((await getSyncState('mock', d)).historyDone).toBe(true);

    // Nutzeränderung muss den nächsten Sync überleben
    const anyTx = (await d.transactions.toArray()).find(t => t.merchant === 'REWE')!;
    await setNote(anyTx.id, 'Wocheneinkauf', d);

    // Zweiter Sync mit Überlappung → keine neuen Umsätze
    await setSetting('sync:mock', { historyDone: true, lastSyncDate: '2026-01-15' }, d);   // große Überlappung erzwingen
    const r2 = await runSync('mock', prompter, () => undefined, d);
    expect(r2.added).toBe(0);
    expect(await d.transactions.count()).toBe(count1);
    expect((await d.transactions.get(anyTx.id))?.notes).toBe('Wocheneinkauf');

    const rec = await d.recurring.toArray();
    const names = rec.map(r => r.merchant);
    expect(names).toEqual(expect.arrayContaining(['Spotify', 'Netflix', 'Vodafone', 'McFIT']));
    expect(rec.find(r => r.merchant === 'Spotify')?.isSubscription).toBe(true);
    // Keine Supermärkte als "Abo"
    expect(names).not.toContain('REWE');
  });

  it('Kategorie für alle ähnlichen ändern und Händler umbenennen', async () => {
    const d = await freshDb('t-actions');
    await runSync('mock', prompter, () => undefined, d);
    const t = (await d.transactions.toArray()).find(x => x.merchant === 'Netflix')!;
    await setCategory(t, 'freizeit.hobbys', true, d);
    const all = await d.transactions.where('merchantKey').equals(t.merchantKey).toArray();
    expect(all.every(x => x.categoryId === 'freizeit.hobbys')).toBe(true);
    await renameMerchant(t.merchantKey, 'Netflix Familie', d);
    expect((await d.transactions.get(t.id))?.merchant).toBe('Netflix Familie');
    // Nach erneutem Sync bleiben Regel und Name
    const r = await runSync('mock', prompter, () => undefined, d);
    expect(r.added).toBe(0);
    expect((await d.transactions.get(t.id))).toMatchObject({ merchant: 'Netflix Familie', categoryId: 'freizeit.hobbys' });
  });

  it('Demo-Daten entfernen', async () => {
    const d = await freshDb('t-remove');
    await setActiveProviders(['mock'], d);
    await runSync('mock', prompter, () => undefined, d);
    await removeProviderData('mock', d);
    expect(await d.transactions.count()).toBe(0);
    expect(await d.accounts.count()).toBe(0);
  });
});

describe('Backup', () => {
  it('Prüfroutine: Export → Import → Export ist identisch', async () => {
    const d = await freshDb('t-backup');
    await runSync('mock', prompter, () => undefined, d);
    await setSetting('fintsBridge', { url: 'https://x', token: 'geheim' }, d);
    const r = await runRoundtripTest(d);
    expect(r.message).toBe('Export und Import sind identisch.');
    expect(r.ok).toBe(true);
  });
  it('Zugangsdaten landen nie im Backup', async () => {
    const d = await freshDb('t-secret');
    await setSetting('fintsBridge', { url: 'https://x', token: 'geheim' }, d);
    const b = await exportBackup(d);
    expect(JSON.stringify(b)).not.toContain('geheim');
  });
  it('Zusammenführen importiert nichts doppelt; kaputte Dateien werden abgelehnt', async () => {
    const d = await freshDb('t-merge');
    await runSync('mock', prompter, () => undefined, d);
    const n = await d.transactions.count();
    const p = checkBackup(JSON.stringify(await exportBackup(d)));
    const res = await importBackup(p.data!, 'merge', d);
    expect(res.added).toBe(0);
    expect(await d.transactions.count()).toBe(n);
    expect(await d.snapshots.count()).toBe(1);
    expect(checkBackup('{kaputt').ok).toBe(false);
    expect(checkBackup('{"app":"basislager"}').fatal).toMatch(/kein Backup/);
  });
});

describe('Historie pro Konto', () => {
  it('holt die volle Historie erneut, wenn ein Konto beim ersten Mal leer blieb', async () => {
    const d = await freshDb('t-history-per-account');
    const calls: { ext: string; from: string }[] = [];
    let giroEmpty = true;
    const tx = (day: string, amount: number) => ({ bookingDate: day, amount, currency: 'EUR', purpose: `Umsatz ${day}` });
    setProvider({
      id: 'fints', label: 'Test',
      open: async () => ({
        getAccounts: async () => [
          { externalId: 'GIRO', name: 'Girokonto', bankName: 'VR', type: 'giro', currency: 'EUR' },
          { externalId: 'SPAR', name: 'Sparkonto', bankName: 'VR', type: 'savings', currency: 'EUR' }
        ],
        getBalance: async () => ({ balance: 0, at: Date.now() }),
        getTransactions: async (ext, from) => {
          calls.push({ ext, from });
          if (ext === 'SPAR') return [tx('2026-01-02', 100)];
          return giroEmpty ? [] : [tx('2026-02-03', -500), tx('2026-09-01', -700)];
        },
        close: async () => undefined
      })
    });
    await setActiveProviders(['fints'], d);
    await runSync('fints', prompter, () => undefined, d);
    const firstFrom = calls[0]!.from;
    expect(calls.every(c => c.from === firstFrom)).toBe(true);

    // Zweiter Sync: Girokonto bekommt erneut die volle Historie, Sparkonto nur die letzten Tage
    calls.length = 0; giroEmpty = false;
    const r = await runSync('fints', prompter, () => undefined, d);
    expect(calls.find(c => c.ext === 'GIRO')!.from).toBe(firstFrom);
    expect(calls.find(c => c.ext === 'SPAR')!.from > firstFrom).toBe(true);
    expect(r.added).toBe(2);
    const log = (await d.syncLog.toArray()).at(-1)!;
    expect(log.message).toContain('Girokonto 2');

    // Dritter Sync: beide Konten erledigt
    calls.length = 0;
    await runSync('fints', prompter, () => undefined, d);
    expect(calls.every(c => c.from > firstFrom)).toBe(true);
  });
});

describe('Vorgemerkte Umsätze', () => {
  it('werden ersetzt, verschwinden nach der Buchung und vererben eigene Änderungen', async () => {
    const d = await freshDb('t-pending');
    const ctx = await loadContext(d);
    const base = { currency: 'EUR', purpose: 'REWE SAGT DANKE', counterpartyName: 'REWE' };
    const acc = 'fints:DE1';

    await importTransactions(d, acc, [{ ...base, bookingDate: '2026-10-28', amount: -1234, pending: true }], ctx);
    let all = await d.transactions.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]!.pending).toBe(true);
    await setNote(all[0]!.id, 'Party', d);

    // gleicher Stand erneut → kein Duplikat, Notiz bleibt
    await importTransactions(d, acc, [{ ...base, bookingDate: '2026-10-28', amount: -1234, pending: true }], ctx);
    all = await d.transactions.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]!.notes).toBe('Party');

    // gebucht (anderes Datum, anderer Text) → vorgemerkter weg, Notiz übernommen
    await importTransactions(d, acc, [{ ...base, purpose: 'REWE MARKT 4711 KARTE', bookingDate: '2026-10-30', amount: -1234 }], ctx);
    all = await d.transactions.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]!.pending).toBeUndefined();
    expect(all[0]!.notes).toBe('Party');
  });

  it('ein vorgemerkter Umsatz überschreibt nie einen gebuchten', async () => {
    const d = await freshDb('t-pending2');
    const ctx = await loadContext(d);
    const t = { currency: 'EUR', purpose: 'X', bookingDate: '2026-10-28', amount: -500 };
    await importTransactions(d, 'a', [t, { ...t, pending: true }], ctx);
    expect(await d.transactions.count()).toBe(2);
    expect((await d.transactions.toArray()).filter(x => x.pending)).toHaveLength(1);
  });
});
