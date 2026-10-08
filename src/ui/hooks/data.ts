/** Lese-Hooks auf die lokale Datenbank. useLiveQuery aktualisiert automatisch bei jeder Änderung. */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db, type Category } from '../../core/db';
import { addMonths, daysInMonth, today } from '../../core/dates';
import { monthSummary, monthToDay, toEntries, type Entry, type Summary } from '../../domain/stats';
import { budgetStatus, type BudgetStatus } from '../../domain/budgets';

export function useCategories() {
  const list = useLiveQuery(() => db.categories.orderBy('id').toArray(), []);
  return useMemo(() => {
    const sorted = (list ?? []).slice().sort((a, b) => a.order - b.order);
    return { list: sorted, map: new Map<string, Category>(sorted.map(c => [c.id, c])), ready: !!list };
  }, [list]);
}

export const useAccounts = () => useLiveQuery(() => db.accounts.toArray().then(a => a.sort((x, y) => x.order - y.order)), []);
export const useAllTransactions = () => useLiveQuery(() => db.transactions.orderBy('bookingDate').reverse().toArray(), []);
export const useRecurring = () => useLiveQuery(() => db.recurring.toArray(), []);
export const useBudgets = () => useLiveQuery(() => db.budgets.toArray(), []);
export const useSetting = <T,>(key: string) => useLiveQuery(async () => ({ v: (await db.settings.get(key))?.value as T | undefined }), [key]);

/** Einträge aller Umsätze (für Auswertungen) – einmal berechnet, von allen Ansichten geteilt. */
export function useEntries(): Entry[] | undefined {
  const txs = useAllTransactions();
  const { map, ready } = useCategories();
  return useMemo(() => (txs && ready ? toEntries(txs, map) : undefined), [txs, map, ready]);
}

export interface MonthData { month: string; running: boolean; day: number; cur: Summary; prevSame: Summary; prevFull: Summary; budgets: BudgetStatus[] }
export function useMonth(month: string): MonthData | undefined {
  const entries = useEntries();
  const budgets = useBudgets();
  return useMemo(() => {
    if (!entries || !budgets) return undefined;
    const t = today();
    const running = t.slice(0, 7) === month;
    const day = running ? Number(t.slice(8)) : daysInMonth(month);
    const cur = monthSummary(entries, month);
    const prev = addMonths(month, -1);
    return {
      month, running, day, cur,
      prevSame: running ? monthToDay(entries, prev, day) : monthSummary(entries, prev),
      prevFull: monthSummary(entries, prev),
      budgets: budgets.map(b => budgetStatus(b, cur))
    };
  }, [entries, budgets, month]);
}
