/** Abgleich der erkannten wiederkehrenden Zahlungen mit der Datenbank. Eigene Entscheidungen bleiben erhalten. */
import type { MyMoneyDB, Recurring, Transaction } from '../core/db';
import { newId } from '../core/ids';
import { today } from '../core/dates';
import { detectRecurring, nextDue } from '../domain/recurring';

export async function refreshRecurring(d: MyMoneyDB, now = today()): Promise<{ found: number }> {
  const [txs, cats, existingRows] = await Promise.all([d.transactions.toArray(), d.categories.toArray(), d.recurring.toArray()]);
  const catMap = new Map(cats.map(c => [c.id, c]));
  const detected = detectRecurring(txs, catMap, now);
  const byKey = new Map(existingRows.map(r => [r.key, r]));
  const ts = Date.now();
  const puts: Recurring[] = [];
  const txLink = new Map<string, string>();   // txId → recurringId
  const seen = new Set<string>();

  for (const det of detected) {
    const prev = byKey.get(det.key);
    seen.add(det.key);
    const row: Recurring = prev ? {
      ...prev,
      merchant: det.merchant, amount: det.amount, interval: prev.source === 'manual' ? prev.interval : det.interval,
      lastDate: det.lastDate, nextDate: prev.source === 'manual' ? nextDue(det.lastDate, prev.interval) : det.nextDate, count: det.count,
      categoryId: det.categoryId, updatedAt: ts
    } : {
      id: newId(), key: det.key, merchant: det.merchant, categoryId: det.categoryId, amount: det.amount, interval: det.interval,
      lastDate: det.lastDate, nextDate: det.nextDate, count: det.count, isSubscription: det.isSubscription, isFixedCost: det.isFixedCost,
      status: 'detected', source: 'auto', createdAt: ts, updatedAt: ts
    };
    puts.push(row);
    if (row.status !== 'dismissed') for (const id of det.txIds) txLink.set(id, row.id);
  }
  // Nicht mehr erkannte, unbestätigte Vorschläge entfernen; bestätigte/eigene bleiben
  const remove = existingRows.filter(r => !seen.has(r.key) && r.status === 'detected' && r.source === 'auto').map(r => r.id);
  // Eigene Reihen ohne aktuelle Erkennung: Umsätze desselben Händlers trotzdem verknüpfen
  for (const r of existingRows) {
    if (seen.has(r.key) || r.status === 'dismissed' || remove.includes(r.id)) continue;
    const [mk, dir] = r.key.split('|');
    const own = txs.filter(t => t.merchantKey === mk && (t.amount < 0 ? '-' : '+') === dir && !t.ignored).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    for (const t of own) txLink.set(t.id, r.id);
    const last = own[own.length - 1];
    if (last && last.bookingDate > r.lastDate) puts.push({ ...r, lastDate: last.bookingDate, nextDate: nextDue(last.bookingDate, r.interval), updatedAt: ts });
  }

  await d.transaction('rw', d.recurring, d.transactions, async () => {
    await d.recurring.bulkDelete(remove);
    await d.recurring.bulkPut(puts);
    const changed: Transaction[] = [];
    for (const t of txs) {
      const want = txLink.get(t.id);
      if (want !== t.recurringId) {
        const n = { ...t };
        if (want) n.recurringId = want; else delete n.recurringId;
        changed.push(n);
      }
    }
    await d.transactions.bulkPut(changed);
  });
  return { found: detected.length };
}
