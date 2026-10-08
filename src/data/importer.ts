/**
 * Übernimmt Umsätze einer Bank in die lokale Datenbank.
 * - Duplikate werden über dedupeKey erkannt (domain/dedupe.ts).
 * - Bei bekannten Umsätzen werden nur die Bankfelder aktualisiert. Eigene Änderungen
 *   (Kategorie von Hand, Notiz, Händlername, Aufteilung, Ignorieren) bleiben immer erhalten.
 */
import type { Category, MerchantAlias, MyMoneyDB, Rule, Transaction } from '../core/db';
import type { BankTransactionData } from '../banking/types';
import { newId } from '../core/ids';
import { dedupeKeys } from '../domain/dedupe';
import { categorizeTransaction, kindFor } from '../domain/categorize';
import { displayName, merchantKey } from '../domain/normalize';

export interface ImportContext { rules: Rule[]; aliases: Map<string, MerchantAlias>; cats: Map<string, Category> }

export async function loadContext(d: MyMoneyDB): Promise<ImportContext> {
  const [rules, aliases, cats] = await Promise.all([d.rules.toArray(), d.merchants.toArray(), d.categories.toArray()]);
  return { rules, aliases: new Map(aliases.map(a => [a.key, a])), cats: new Map(cats.map(c => [c.id, c])) };
}

/** Kategorie, Händler und Art für einen Umsatz bestimmen (ohne manuelle Felder anzufassen). */
export function derive(raw: Pick<BankTransactionData, 'amount' | 'counterpartyName' | 'purpose' | 'bookingText'>, ctx: ImportContext) {
  const key = merchantKey(raw.counterpartyName, raw.purpose);
  const r = categorizeTransaction({ ...raw, merchantKey: key }, ctx.rules);
  const merchant = ctx.aliases.get(key)?.name ?? r.merchant ?? displayName(raw.counterpartyName || raw.purpose, key);
  return { merchantKey: key, merchant, categoryId: r.categoryId, matched: r.matched, kind: kindFor(ctx.cats.get(r.categoryId)?.kind, raw.amount) };
}

export async function importTransactions(d: MyMoneyDB, accountId: string, list: BankTransactionData[], ctx: ImportContext): Promise<{ added: number; updated: number }> {
  const keys = dedupeKeys(list.map(t => ({ ...t, accountId })));
  const existing = new Map((await d.transactions.where('dedupeKey').anyOf(keys).toArray()).map(t => [t.dedupeKey, t]));
  const now = Date.now();
  let added = 0, updated = 0;
  const rows: Transaction[] = list.map((raw, i) => {
    const key = keys[i]!;
    const prev = existing.get(key);
    const bank = {
      bankRef: raw.bankRef, bookingDate: raw.bookingDate, valueDate: raw.valueDate, amount: raw.amount, currency: raw.currency,
      counterpartyName: raw.counterpartyName, counterpartyIban: raw.counterpartyIban, purpose: raw.purpose,
      bookingText: raw.bookingText, e2eRef: raw.e2eRef, mandateRef: raw.mandateRef, creditorId: raw.creditorId
    };
    const der = derive(raw, ctx);
    if (prev) {
      updated++;
      const manual = prev.categorySource === 'manual';
      return {
        ...prev, ...bank,
        merchantKey: der.merchantKey,
        merchant: ctx.aliases.get(der.merchantKey)?.name ?? (manual ? prev.merchant : der.merchant),
        ...(manual ? {} : { categoryId: der.categoryId, categorySource: der.matched ? 'rule' : 'none', kind: der.kind }),
        updatedAt: now
      } as Transaction;
    }
    added++;
    return {
      id: newId(), accountId, dedupeKey: key, ...bank,
      merchantKey: der.merchantKey, merchant: der.merchant, categoryId: der.categoryId,
      categorySource: der.matched ? 'rule' : 'none', kind: der.kind,
      createdAt: now, updatedAt: now
    };
  });
  // undefined-Felder entfernen (IndexedDB speichert sie sonst als Schlüssel mit)
  for (const r of rows) for (const k of Object.keys(r) as (keyof Transaction)[]) if (r[k] === undefined) delete r[k];
  await d.transactions.bulkPut(rows);
  return { added, updated };
}

/** Alle nicht von Hand kategorisierten Umsätze neu einordnen (nach Regeländerung). */
export async function recategorizeAll(d: MyMoneyDB): Promise<number> {
  const ctx = await loadContext(d);
  let changed = 0;
  await d.transaction('rw', d.transactions, async () => {
    const all = await d.transactions.toArray();
    const puts: Transaction[] = [];
    for (const t of all) {
      const der = derive(t, ctx);
      const merchant = ctx.aliases.get(t.merchantKey)?.name ?? (t.categorySource === 'manual' ? t.merchant : der.merchant);
      if (t.categorySource === 'manual') {
        if (merchant !== t.merchant) { puts.push({ ...t, merchant, updatedAt: Date.now() }); changed++; }
        continue;
      }
      const src = der.matched ? 'rule' : 'none';
      if (der.categoryId !== t.categoryId || merchant !== t.merchant || src !== t.categorySource || der.kind !== t.kind) {
        puts.push({ ...t, categoryId: der.categoryId, merchant, categorySource: src, kind: der.kind, updatedAt: Date.now() });
        changed++;
      }
    }
    await d.transactions.bulkPut(puts);
  });
  return changed;
}
