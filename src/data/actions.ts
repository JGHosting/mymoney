/** Änderungen durch den Nutzer. Jede Funktion schreibt direkt in die lokale Datenbank. */
import type { Budget, Category, CategoryColor, Interval, MyMoneyDB, Recurring, Rule, Split, Transaction } from '../core/db';
import { db as mainDb } from '../core/db';
import { newId } from '../core/ids';
import { kindFor } from '../domain/categorize';
import { nextDue } from '../domain/recurring';
import { recategorizeAll } from './importer';
import { refreshRecurring } from './recurring';

const now = () => Date.now();

/* ---------- Umsätze ---------- */

/**
 * Kategorie ändern. forAll=true legt eine Regel für diesen Händler an
 * und ordnet alle bisherigen (nicht von Hand geänderten) Umsätze neu ein.
 */
export async function setCategory(tx: Transaction, categoryId: string, forAll: boolean, d: MyMoneyDB = mainDb) {
  const cat = await d.categories.get(categoryId);
  await d.transactions.update(tx.id, { categoryId, categorySource: 'manual', kind: kindFor(cat?.kind, tx.amount), updatedAt: now() });
  if (forAll) {
    const existing = (await d.rules.toArray()).find(r => r.field === 'merchantKey' && r.pattern === tx.merchantKey);
    const rule: Rule = existing
      ? { ...existing, categoryId, updatedAt: now() }
      : { id: newId(), pattern: tx.merchantKey, field: 'merchantKey', categoryId, createdAt: now(), updatedAt: now() };
    await d.rules.put(rule);
    await recategorizeAll(d);
  }
  await refreshRecurring(d);
}

/** Händlername ändern – gilt für alle Umsätze dieses Händlers. */
export async function renameMerchant(merchantKey: string, name: string, d: MyMoneyDB = mainDb) {
  const clean = name.trim();
  await d.transaction('rw', d.merchants, d.transactions, d.recurring, async () => {
    if (clean) await d.merchants.put({ key: merchantKey, name: clean, updatedAt: now() });
    else await d.merchants.delete(merchantKey);
    if (clean) {
      await d.transactions.where('merchantKey').equals(merchantKey).modify({ merchant: clean, updatedAt: now() });
      await d.recurring.filter(r => r.key.startsWith(merchantKey + '|')).modify({ merchant: clean, updatedAt: now() });
    }
  });
  if (!clean) await recategorizeAll(d);
}

export async function setNote(id: string, notes: string, d: MyMoneyDB = mainDb) {
  await d.transactions.update(id, { notes: notes.trim() || undefined, updatedAt: now() });
}

export async function setIgnored(id: string, ignored: boolean, d: MyMoneyDB = mainDb) {
  await d.transactions.update(id, { ignored: ignored || undefined, updatedAt: now() });
  await refreshRecurring(d);
}

/** Aufteilen. Die Summe der Teile muss dem Betrag entsprechen; leere Liste hebt die Aufteilung auf. */
export async function setSplits(tx: Transaction, splits: Split[], d: MyMoneyDB = mainDb) {
  if (splits.length) {
    const sum = splits.reduce((s, x) => s + x.amount, 0);
    if (sum !== tx.amount) throw new Error('Die Teilbeträge ergeben nicht den Gesamtbetrag.');
  }
  await d.transactions.update(tx.id, { splits: splits.length ? splits : undefined, updatedAt: now() });
}

/* ---------- Wiederkehrende Zahlungen ---------- */

export async function markRecurring(tx: Transaction, interval: Interval, d: MyMoneyDB = mainDb) {
  const key = `${tx.merchantKey}|${tx.amount < 0 ? '-' : '+'}`;
  const prev = await d.recurring.where('key').equals(key).first();
  const cat = await d.categories.get(tx.categoryId);
  const row: Recurring = {
    id: prev?.id ?? newId(), key, merchant: tx.merchant, categoryId: tx.categoryId, amount: tx.amount, interval,
    lastDate: prev && prev.lastDate > tx.bookingDate ? prev.lastDate : tx.bookingDate,
    nextDate: nextDue(prev && prev.lastDate > tx.bookingDate ? prev.lastDate : tx.bookingDate, interval),
    count: prev?.count ?? 1,
    isSubscription: prev?.isSubscription ?? false,
    isFixedCost: prev?.isFixedCost ?? (tx.amount < 0 && cat?.kind === 'expense'),
    status: 'confirmed', source: 'manual', createdAt: prev?.createdAt ?? now(), updatedAt: now()
  };
  await d.recurring.put(row);
  await refreshRecurring(d);
}

export async function updateRecurring(id: string, patch: Partial<Pick<Recurring, 'status' | 'isSubscription' | 'isFixedCost' | 'interval' | 'merchant'>>, d: MyMoneyDB = mainDb) {
  const r = await d.recurring.get(id);
  if (!r) return;
  const next = { ...r, ...patch, updatedAt: now() };
  if (patch.interval) next.nextDate = nextDue(r.lastDate, patch.interval);
  await d.recurring.put(next);
  if (patch.status) await refreshRecurring(d);
}

/** "Nicht wiederkehrend": Vorschlag verwerfen (bleibt verworfen, auch beim nächsten Sync). */
export async function dismissRecurring(id: string, d: MyMoneyDB = mainDb) {
  await updateRecurring(id, { status: 'dismissed' }, d);
}

/* ---------- Budgets ---------- */

export async function saveBudget(categoryId: string, amount: number, d: MyMoneyDB = mainDb) {
  const prev = await d.budgets.where('categoryId').equals(categoryId).first();
  const row: Budget = { id: prev?.id ?? newId(), categoryId, amount, createdAt: prev?.createdAt ?? now(), updatedAt: now() };
  await d.budgets.put(row);
}
export async function deleteBudget(id: string, d: MyMoneyDB = mainDb) { await d.budgets.delete(id); }

/* ---------- Kategorien ---------- */

export async function saveCategory(c: Partial<Category> & { name: string; kind: Category['kind'] }, d: MyMoneyDB = mainDb): Promise<string> {
  const prev = c.id ? await d.categories.get(c.id) : undefined;
  const parent = c.parentId ? await d.categories.get(c.parentId) : undefined;
  const count = await d.categories.count();
  const row: Category = {
    id: prev?.id ?? `own.${newId().slice(0, 8)}`,
    name: c.name.trim(),
    kind: parent?.kind ?? c.kind,
    icon: c.icon ?? prev?.icon ?? parent?.icon ?? 'tag',
    color: (c.color ?? prev?.color ?? parent?.color ?? 'c12') as CategoryColor,
    order: prev?.order ?? (parent ? parent.order + 50 : count * 100),
    ...(c.parentId ?? prev?.parentId ? { parentId: c.parentId ?? prev?.parentId } : {}),
    ...(prev?.builtin ? { builtin: true } : {}),
    createdAt: prev?.createdAt ?? now(), updatedAt: now()
  };
  await d.categories.put(row);
  return row.id;
}

/** Eigene Kategorie löschen. Ihre Umsätze wandern in die Oberkategorie bzw. "Sonstiges". */
export async function deleteCategory(id: string, d: MyMoneyDB = mainDb) {
  const c = await d.categories.get(id);
  if (!c || c.builtin) return;
  const target = c.parentId ?? (c.kind === 'income' ? 'einkommen.sonstiges' : 'sonstiges');
  await d.transaction('rw', [d.categories, d.transactions, d.budgets, d.rules], async () => {
    const children = await d.categories.where('parentId').equals(id).primaryKeys();
    const all = [id, ...children];
    await d.transactions.where('categoryId').anyOf(all).modify({ categoryId: target, updatedAt: now() });
    await d.budgets.where('categoryId').anyOf(all).delete();
    await d.rules.filter(r => all.includes(r.categoryId)).delete();
    await d.categories.bulkDelete(all);
  });
}

/* ---------- Regeln ---------- */

export async function deleteRule(id: string, d: MyMoneyDB = mainDb) {
  await d.rules.delete(id);
  await recategorizeAll(d);
  await refreshRecurring(d);
}
