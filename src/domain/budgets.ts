/** Budgetberechnung. Ein Budget auf eine Oberkategorie umfasst alle Unterkategorien. */
import type { Budget } from '../core/db';
import type { Summary } from './stats';

export type BudgetLevel = 'ok' | 'warn' | 'full' | 'over';
export interface BudgetStatus { budget: Budget; spent: number; remaining: number; pct: number; level: BudgetLevel }

export function budgetLevel(spent: number, limit: number): BudgetLevel {
  if (limit <= 0) return spent > 0 ? 'over' : 'ok';
  if (spent > limit) return 'over';
  if (spent === limit) return 'full';
  return spent / limit >= 0.8 ? 'warn' : 'ok';
}

export function spentFor(categoryId: string, s: Summary): number {
  const isRoot = !categoryId.includes('.');
  return Math.max(0, (isRoot ? s.byRoot.get(categoryId) : s.byCategory.get(categoryId)) ?? 0);
}

export function budgetStatus(budget: Budget, s: Summary): BudgetStatus {
  const spent = spentFor(budget.categoryId, s);
  return {
    budget, spent,
    remaining: budget.amount - spent,
    pct: budget.amount > 0 ? spent / budget.amount : 0,
    level: budgetLevel(spent, budget.amount)
  };
}

/**
 * Erwarteter Stand am Monatsende bei gleichem Tempo – nur als Hinweis.
 * dayOfMonth/daysInMonth beschreiben den bisherigen Anteil des Monats.
 */
export function projectSpent(spent: number, dayOfMonth: number, daysInMonth: number): number {
  if (dayOfMonth <= 0) return spent;
  return Math.round((spent / dayOfMonth) * daysInMonth);
}
