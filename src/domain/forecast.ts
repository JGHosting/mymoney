/** "Wie viel kann ich noch ausgeben?" – Verfügbar abzüglich der in diesem Monat noch erwarteten Fixkosten. */
import type { Recurring } from '../core/db';
import { monthEnd, monthStart } from '../core/dates';
import { effectiveDay } from './stats';

export interface Pending { recurring: Recurring; due: string }

/** Wiederkehrende Ausgaben, die im Monat noch fällig sind (erwartet, aber noch nicht gebucht). */
export function pendingInMonth(recurring: Recurring[], month: string): Pending[] {
  const from = monthStart(month), to = monthEnd(month);
  return recurring
    .filter(r => r.status !== 'dismissed' && r.amount < 0 && r.nextDate >= from && r.nextDate <= to)
    .map(r => ({ recurring: r, due: r.nextDate }))
    .sort((a, b) => a.due.localeCompare(b.due));
}

export function freeToSpend(income: number, expense: number, pending: Pending[]): number {
  return income - expense + pending.reduce((s, p) => s + p.recurring.amount, 0);
}

/** Im Monat noch erwartete Einnahmen (z. B. Gehalt) – nur echte Einkommen, keine Umbuchungen. */
export function expectedIncomeInMonth(recurring: Recurring[], month: string, incomeShiftDay?: number): Pending[] {
  const from = monthStart(month), to = monthEnd(month);
  return recurring
    .filter(r => {
      if (r.status === 'dismissed' || r.amount <= 0 || !r.categoryId.startsWith('einkommen')) return false;
      const d = effectiveDay(r.nextDate, 'income', r.categoryId, incomeShiftDay);   // Gehalt am 28. zählt ggf. erst im Folgemonat
      return d >= from && d <= to;
    })
    .map(r => ({ recurring: r, due: r.nextDate }));
}
