import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { MyMoneyDB } from '../core/db';
import { runSync, setActiveProviders, getSyncState, removeProviderData } from './sync';
import { setCategory, renameMerchant, setNote } from './actions';
import { runRoundtripTest, exportBackup, checkBackup, importBackup } from '../backup/backup';
import { setProvider } from '../banking/registry';
import { createMockProvider } from '../banking/mock/MockBankingProvider';
import { setSetting } from '../core/db';

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
