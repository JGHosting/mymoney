/**
 * Übernimmt Umsätze einer Bank in die lokale Datenbank.
 * - Duplikate werden über dedupeKey erkannt (domain/dedupe.ts).
 * - Bei bekannten Umsätzen werden nur die Bankfelder aktualisiert. Eigene Änderungen
 *   (Kategorie von Hand, Notiz, Händlername, Aufteilung, Ignorieren) bleiben immer erhalten.
 * - Vorgemerkte Umsätze (pending) sind der aktuelle Stand der Bank und werden bei jedem Abruf ersetzt.
 *   Wird ein vorgemerkter Umsatz gebucht, gehen eigene Änderungen auf den gebuchten Umsatz über.
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

const PENDING_MATCH_DAYS = 10;
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
/** Eigene Änderungen, die von einem vorgemerkten auf den gebuchten Umsatz übergehen. */
function userFields(t: Transaction): Partial<Transaction> {
  const out: Partial<Transaction> = {};
  if (t.categorySource === 'manual') Object.assign(out, { categoryId: t.categoryId, categorySource: t.categorySource, kind: t.kind, merchant: t.merchant });
  if (t.notes) out.notes = t.notes;
  if (t.splits) out.splits = t.splits;
  if (t.ignored) out.ignored = t.ignored;
  return out;
}

export async function importTransactions(d: MyMoneyDB, accountId: string, all: BankTransactionData[], ctx: ImportContext): Promise<{ added: number; updated: number }> {
  const list = all.filter(t => !t.pending);
  const pendingList = all.filter(t => t.pending);
  const keys = [
    ...dedupeKeys(list.map(t => ({ ...t, accountId }))),
    // eigener Schlüsselraum: ein vorgemerkter Umsatz darf nie einen gebuchten überschreiben
    ...dedupeKeys(pendingList.map(t => ({ ...t, accountId: `${accountId}|vorgemerkt` })))
  ];
  const oldPending = await d.transactions.where('accountId').equals(accountId).filter(t => !!t.pending).toArray();
  const keep = new Set(keys);
  /** Vorgemerkte, die die Bank nicht mehr meldet (gebucht oder storniert) → werden gelöscht. */
  const gone = oldPending.filter(t => !keep.has(t.dedupeKey));
  const existing = new Map((await d.transactions.where('dedupeKey').anyOf(keys).toArray()).map(t => [t.dedupeKey, t]));
  const now = Date.now();
  let added = 0, updated = 0;
  const rows: Transaction[] = [...list, ...pendingList].map((raw, i) => {
    const key = keys[i]!;
    const prev = existing.get(key);
    const bank = {
      bankRef: raw.bankRef, bookingDate: raw.bookingDate, valueDate: raw.valueDate, amount: raw.amount, currency: raw.currency,
      counterpartyName: raw.counterpartyName, counterpartyIban: raw.counterpartyIban, purpose: raw.purpose,
      bookingText: raw.bookingText, e2eRef: raw.e2eRef, mandateRef: raw.mandateRef, creditorId: raw.creditorId,
      pending: raw.pending ? true : undefined
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
    // Neu gebucht: passt ein verschwundener vorgemerkter Umsatz (gleicher Betrag, zeitnah)? → eigene Änderungen übernehmen
    let carried: Partial<Transaction> = {};
    if (!raw.pending) {
      const j = gone.findIndex(p => p.amount === raw.amount && dayDiff(p.bookingDate, raw.bookingDate) <= PENDING_MATCH_DAYS);
      if (j >= 0) carried = userFields(gone.splice(j, 1)[0]!);
    }
    return {
      id: newId(), accountId, dedupeKey: key, ...bank,
      merchantKey: der.merchantKey, merchant: der.merchant, categoryId: der.categoryId,
      categorySource: der.matched ? 'rule' : 'none', kind: der.kind,
      ...carried,
      createdAt: now, updatedAt: now
    };
  });
  // undefined-Felder entfernen (IndexedDB speichert sie sonst als Schlüssel mit)
  for (const r of rows) for (const k of Object.keys(r) as (keyof Transaction)[]) if (r[k] === undefined) delete r[k];
  await d.transaction('rw', d.transactions, async () => {
    await d.transactions.bulkDelete(oldPending.filter(t => !keep.has(t.dedupeKey)).map(t => t.id));
    await d.transactions.bulkPut(rows);
  });
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
