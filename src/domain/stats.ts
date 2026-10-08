/**
 * Auswertungen: Monatssummen, Kategorien, Vergleiche, Sparquote.
 * Grundlage sind "Einträge": ein Umsatz ergibt einen Eintrag, ein aufgeteilter Umsatz mehrere.
 * Ignorierte Umsätze und Umbuchungen (eigene Konten, Sparen) zählen weder als Einnahme noch als Ausgabe.
 */
import type { Category, Transaction, TxKind } from '../core/db';
import { addMonths, daysInMonth, monthEnd, monthOf, monthStart } from '../core/dates';
import { rootOf } from './categories';

export interface Entry { txId: string; day: string; categoryId: string; root: string; amount: number; kind: TxKind }

export function toEntries(txs: Transaction[], cats: Map<string, Category>): Entry[] {
  const out: Entry[] = [];
  for (const t of txs) {
    if (t.ignored) continue;
    const parts = t.splits?.length ? t.splits : [{ categoryId: t.categoryId, amount: t.amount }];
    for (const p of parts) {
      const kind = cats.get(p.categoryId)?.kind ?? t.kind;
      out.push({ txId: t.id, day: t.bookingDate, categoryId: p.categoryId, root: rootOf(p.categoryId, cats), amount: p.amount, kind });
    }
  }
  return out;
}

export interface Summary {
  income: number;          // Cent, positiv
  expense: number;         // Cent, positiv (Erstattungen bereits abgezogen)
  net: number;             // income − expense
  byRoot: Map<string, number>;      // Ausgaben je Oberkategorie (positiv)
  byCategory: Map<string, number>;  // Ausgaben je Kategorie (positiv)
  incomeByRoot: Map<string, number>;
  count: number;
}

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

export function summarize(entries: Entry[], from: string, to: string): Summary {
  const s: Summary = { income: 0, expense: 0, net: 0, byRoot: new Map(), byCategory: new Map(), incomeByRoot: new Map(), count: 0 };
  for (const e of entries) {
    if (e.day < from || e.day > to) continue;
    if (e.kind === 'transfer') continue;
    s.count++;
    if (e.kind === 'income') { s.income += e.amount; add(s.incomeByRoot, e.root, e.amount); }
    else { s.expense -= e.amount; add(s.byRoot, e.root, -e.amount); add(s.byCategory, e.categoryId, -e.amount); }
  }
  s.net = s.income - s.expense;
  return s;
}

export const monthSummary = (entries: Entry[], month: string) => summarize(entries, monthStart(month), monthEnd(month));

/** Monat bis einschließlich Tag n (für faire Vergleiche mit einem laufenden Monat). */
export function monthToDay(entries: Entry[], month: string, day: number): Summary {
  const d = Math.min(day, daysInMonth(month));
  return summarize(entries, monthStart(month), `${month}-${String(d).padStart(2, '0')}`);
}

/** Relative Veränderung; null, wenn der Vergleichswert 0 ist. */
export function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / Math.abs(previous);
}

/** Sparquote = (Einnahmen − Ausgaben) / Einnahmen; null ohne Einnahmen. */
export function savingsRate(income: number, expense: number): number | null {
  if (income <= 0) return null;
  return (income - expense) / income;
}

export interface MonthPoint { month: string; income: number; expense: number; net: number }
export function monthlySeries(entries: Entry[], lastMonth: string, n: number): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = addMonths(lastMonth, -i);
    const s = monthSummary(entries, m);
    out.push({ month: m, income: s.income, expense: s.expense, net: s.net });
  }
  return out;
}

/** Ausgaben pro Tag im Zeitraum (Index 0 = from). */
export function dailyExpenses(entries: Entry[], from: string, days: number, dayList: string[]): number[] {
  const idx = new Map(dayList.map((d, i) => [d, i]));
  const out = new Array<number>(days).fill(0);
  for (const e of entries) {
    if (e.kind !== 'expense' || e.day < from) continue;
    const i = idx.get(e.day);
    if (i != null) out[i] = (out[i] ?? 0) - e.amount;
  }
  return out;
}

/** Kumulierte Ausgaben je Tag des Monats (für "Ausgabenverlauf vs. Vormonat"). */
export function cumulativeByDay(entries: Entry[], month: string): number[] {
  const n = daysInMonth(month);
  const out = new Array<number>(n).fill(0);
  for (const e of entries) {
    if (e.kind !== 'expense' || monthOf(e.day) !== month) continue;
    const d = Number(e.day.slice(8)) - 1;
    out[d] = (out[d] ?? 0) - e.amount;
  }
  for (let i = 1; i < n; i++) out[i] = (out[i] ?? 0) + (out[i - 1] ?? 0);
  return out;
}

/** Durchschnitt über die n vollen Monate vor `month`. Monate ohne jegliche Umsätze zählen nicht. */
export function averageMonth(entries: Entry[], month: string, n = 3): { income: number; expense: number; months: number } {
  let inc = 0, exp = 0, k = 0;
  for (let i = 1; i <= n; i++) {
    const s = monthSummary(entries, addMonths(month, -i));
    if (!s.count) continue;
    inc += s.income; exp += s.expense; k++;
  }
  return { income: k ? Math.round(inc / k) : 0, expense: k ? Math.round(exp / k) : 0, months: k };
}

/** Größte Einzelausgaben im Zeitraum. */
export function largestExpenses(txs: Transaction[], cats: Map<string, Category>, from: string, to: string, n = 5): Transaction[] {
  return txs
    .filter(t => !t.ignored && t.amount < 0 && t.bookingDate >= from && t.bookingDate <= to && (cats.get(t.categoryId)?.kind ?? t.kind) === 'expense')
    .sort((a, b) => a.amount - b.amount)
    .slice(0, n);
}
