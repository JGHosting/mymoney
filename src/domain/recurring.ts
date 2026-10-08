/**
 * Heuristische Erkennung wiederkehrender Zahlungen (Fixkosten, Abos, Gehalt, Sparraten).
 *
 * Vorgehen je Händler + Richtung (Ein-/Ausgang):
 * 1. Typischen Betrag bestimmen (Median) und nur Zahlungen in dessen Nähe behalten.
 * 2. Abstände zwischen den Zahlungen → Intervall (wöchentlich … jährlich), wenn sie regelmäßig sind.
 * 3. Nur aktive Reihen: Die letzte Zahlung darf nicht deutlich länger als ein Intervall zurückliegen.
 */
import type { Category, Interval, Transaction } from '../core/db';
import { addDays, addMonthsToDay, daysBetween } from '../core/dates';
import { rootOf } from './categories';

export interface DetectedRecurring {
  key: string;
  merchant: string;
  categoryId: string;
  amount: number;
  interval: Interval;
  lastDate: string;
  nextDate: string;
  count: number;
  txIds: string[];
  isSubscription: boolean;
  isFixedCost: boolean;
}

const INTERVALS: { id: Interval; min: number; max: number; minCount: number }[] = [
  { id: 'weekly', min: 6, max: 8, minCount: 4 },
  { id: 'monthly', min: 26, max: 35, minCount: 3 },
  { id: 'quarterly', min: 84, max: 98, minCount: 2 },
  { id: 'halfyearly', min: 172, max: 192, minCount: 2 },
  { id: 'yearly', min: 350, max: 380, minCount: 2 }
];
export const INTERVAL_DAYS: Record<Interval, number> = { weekly: 7, monthly: 30.44, quarterly: 91.3, halfyearly: 182.6, yearly: 365.25 };
export const INTERVAL_LABEL: Record<Interval, string> = { weekly: 'wöchentlich', monthly: 'monatlich', quarterly: 'vierteljährlich', halfyearly: 'halbjährlich', yearly: 'jährlich' };

const SUBSCRIPTION_CATS = new Set(['freizeit.streaming', 'freizeit.digital', 'freizeit.gaming', 'freizeit.sport']);
const FIXED_ROOTS = new Set(['wohnen', 'versicherungen']);
const FIXED_CATS = new Set(['mobilitaet.auto', 'mobilitaet.oepnv']);

export function nextDue(last: string, interval: Interval): string {
  switch (interval) {
    case 'weekly': return addDays(last, 7);
    case 'monthly': return addMonthsToDay(last, 1);
    case 'quarterly': return addMonthsToDay(last, 3);
    case 'halfyearly': return addMonthsToDay(last, 6);
    case 'yearly': return addMonthsToDay(last, 12);
  }
}

/** Betrag auf einen Monat umgerechnet (für Fixkosten-Summen). */
export function monthlyAmount(amount: number, interval: Interval): number {
  return Math.round(amount * (30.44 / INTERVAL_DAYS[interval]));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

export function detectRecurring(txs: Transaction[], cats: Map<string, Category>, today: string): DetectedRecurring[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.ignored || t.amount === 0) continue;
    const key = `${t.merchantKey}|${t.amount < 0 ? '-' : '+'}`;
    const g = groups.get(key);
    if (g) g.push(t); else groups.set(key, [t]);
  }
  const out: DetectedRecurring[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    const typical = median(list.map(t => t.amount));
    const found = classify(list, typical);
    if (!found) continue;
    const { interval, kept } = found;
    const last = kept[kept.length - 1]!;
    // Reihe beendet? (letzte Zahlung > 1,6 Intervalle her)
    if (daysBetween(last.bookingDate, today) > INTERVAL_DAYS[interval] * 1.6 + 5) continue;
    const recentAmount = median(kept.slice(-3).map(t => t.amount));   // Preisänderungen berücksichtigen
    const categoryId = last.categoryId;
    const cat = cats.get(categoryId);
    const root = rootOf(categoryId, cats);
    const isExpense = recentAmount < 0 && (cat?.kind ?? 'expense') === 'expense';
    const isSubscription = isExpense && SUBSCRIPTION_CATS.has(categoryId);
    const isFixedCost = isExpense && (isSubscription || FIXED_ROOTS.has(root) || FIXED_CATS.has(categoryId));
    out.push({
      key, merchant: last.merchant, categoryId, amount: recentAmount, interval,
      lastDate: last.bookingDate, nextDate: nextDue(last.bookingDate, interval),
      count: kept.length, txIds: kept.map(t => t.id), isSubscription, isFixedCost
    });
  }
  return out.sort((a, b) => a.amount - b.amount);
}

function classify(list: Transaction[], typical: number): { interval: Interval; kept: Transaction[] } | null {
  for (const iv of INTERVALS) {
    // Wöchentlich nur bei (fast) gleichem Betrag, sonst wäre jeder Wocheneinkauf ein "Abo"
    const tol = iv.id === 'weekly' ? Math.abs(typical) * 0.01 : Math.max(150, Math.abs(typical) * 0.2);
    let kept = list.filter(t => Math.abs(t.amount - typical) <= tol);
    // Nur zwei Zahlungen (z. B. jährlich): Betrag muss praktisch gleich sein, sonst Zufall (zweimal Tanken)
    if (kept.length < 3) kept = kept.filter(t => Math.abs(t.amount - typical) <= Math.abs(typical) * 0.01);
    if (kept.length < iv.minCount) continue;
    const gaps: number[] = [];
    for (let i = 1; i < kept.length; i++) gaps.push(daysBetween(kept[i - 1]!.bookingDate, kept[i]!.bookingDate));
    const regular = gaps.filter(g => g >= iv.min && g <= iv.max).length;
    // Mindestens 75 % der Abstände passen; einzelne Ausreißer (verschobene Abbuchung) sind erlaubt
    if (regular >= Math.max(iv.minCount - 1, Math.ceil(gaps.length * 0.75))) return { interval: iv.id, kept };
  }
  return null;
}
