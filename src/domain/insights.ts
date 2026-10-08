/**
 * Automatisch erzeugte, sachliche Hinweise. Reine Funktion – die UI zeigt nur an.
 * Für einen laufenden Monat wird immer mit dem Vormonat bis zum gleichen Tag verglichen.
 */
import type { Category, Recurring } from '../core/db';
import { addMonths, daysInMonth, monthName, today as todayFn } from '../core/dates';
import { fmtMoney, fmtPct } from '../core/money';
import { averageMonth, change, monthSummary, monthToDay, type Entry } from './stats';
import { monthlyAmount } from './recurring';
import type { BudgetStatus } from './budgets';

export interface Insight { id: string; tone: 'neutral' | 'good' | 'warn'; text: string }

export function buildInsights(opts: {
  entries: Entry[];
  month: string;
  cats: Map<string, Category>;
  recurring: Recurring[];
  budgets: BudgetStatus[];
  today?: string;
}): Insight[] {
  const { entries, month, cats, recurring, budgets } = opts;
  const t = opts.today ?? todayFn();
  const running = t.slice(0, 7) === month;
  const day = running ? Number(t.slice(8)) : daysInMonth(month);
  const prevMonth = addMonths(month, -1);
  const cur = running ? monthToDay(entries, month, day) : monthSummary(entries, month);
  const prev = running ? monthToDay(entries, prevMonth, day) : monthSummary(entries, prevMonth);
  const out: Insight[] = [];
  const prevName = monthName(prevMonth, false);

  // 1. Gesamtausgaben vs. Vormonat
  const ch = change(cur.expense, prev.expense);
  if (ch != null && Math.abs(ch) >= 0.05 && prev.expense > 0) {
    out.push({
      id: 'total', tone: ch < 0 ? 'good' : 'neutral',
      text: `${running ? 'Bisher ' : ''}${fmtPct(Math.abs(ch))} ${ch < 0 ? 'weniger' : 'mehr'} ausgegeben als ${running ? 'zum gleichen Zeitpunkt im' : 'im'} ${prevName}.`
    });
  }

  // 2. Kategorie mit dem stärksten Anstieg (mind. 30 € Unterschied)
  let best: { root: string; diff: number; pct: number | null } | null = null;
  for (const [root, v] of cur.byRoot) {
    const p = prev.byRoot.get(root) ?? 0;
    const diff = v - p;
    if (diff >= 3000 && (!best || diff > best.diff)) best = { root, diff, pct: change(v, p) };
  }
  if (best) {
    const name = cats.get(best.root)?.name ?? best.root;
    out.push({
      id: 'cat-up', tone: 'warn',
      text: best.pct != null && best.pct < 5
        ? `Deine Ausgaben für ${name} sind ${fmtPct(best.pct)} höher als im ${prevName}.`
        : `Für ${name} hast du ${fmtMoney(best.diff, { round: true })} mehr ausgegeben als im ${prevName}.`
    });
  }

  // 3. Vergleich mit dem Durchschnitt der letzten drei Monate (nur abgeschlossene Monate)
  if (!running) {
    const avg = averageMonth(entries, month, 3);
    const diff = avg.expense - cur.expense;
    if (avg.months >= 2 && Math.abs(diff) >= 5000) {
      out.push({
        id: 'avg', tone: diff > 0 ? 'good' : 'neutral',
        text: `Im ${monthName(month, false)} hast du ${fmtMoney(Math.abs(diff), { round: true })} ${diff > 0 ? 'weniger' : 'mehr'} ausgegeben als im Durchschnitt.`
      });
    }
  }

  // 4. Fixkostenanteil am Einkommen
  const active = recurring.filter(r => r.status !== 'dismissed');
  const fixed = active.filter(r => r.isFixedCost).reduce((s, r) => s + -monthlyAmount(r.amount, r.interval), 0);
  const avgIncome = averageMonth(entries, month, 3).income || cur.income;
  if (fixed > 0 && avgIncome > 0) {
    out.push({ id: 'fixed', tone: fixed / avgIncome > 0.5 ? 'warn' : 'neutral', text: `Deine Fixkosten machen ${fmtPct(fixed / avgIncome)} deiner monatlichen Einnahmen aus.` });
  }

  // 5. Budgets
  const over = budgets.filter(b => b.level === 'over');
  const warn = budgets.filter(b => b.level === 'warn' || b.level === 'full');
  if (over.length) out.push({ id: 'b-over', tone: 'warn', text: over.length === 1 ? `Budget ${cats.get(over[0]!.budget.categoryId)?.name ?? ''} ist überschritten.` : `${over.length} Budgets sind überschritten.` });
  else if (warn.length) out.push({ id: 'b-warn', tone: 'neutral', text: warn.length === 1 ? `Budget ${cats.get(warn[0]!.budget.categoryId)?.name ?? ''} ist zu ${fmtPct(warn[0]!.pct)} ausgeschöpft.` : `${warn.length} Budgets sind zu mehr als 80 % ausgeschöpft.` });

  // 6. Neu erkannte wiederkehrende Zahlungen
  const fresh = active.filter(r => r.status === 'detected');
  if (fresh.length) out.push({ id: 'rec', tone: 'neutral', text: `${fresh.length === 1 ? 'Eine wiederkehrende Zahlung wurde' : `${fresh.length} wiederkehrende Zahlungen wurden`} erkannt.` });

  return out;
}
