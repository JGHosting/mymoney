/**
 * Regelbasierte Kategorisierung. Später austauschbar gegen ein lernendes Verfahren –
 * der Rest der App ruft nur categorizeTransaction() auf.
 */
import type { Rule, TxKind } from '../core/db';
import { BUILTIN_RULES } from './rules';
import { upper } from './normalize';
import { TRANSFER_CATEGORY, UNCATEGORIZED_EXPENSE, UNCATEGORIZED_INCOME } from './categories';

export interface CategorizeInput {
  amount: number;
  counterpartyName?: string;
  purpose: string;
  bookingText?: string;
  merchantKey?: string;
}
export interface CategorizeResult { categoryId: string; merchant?: string; ruleId?: string; matched: boolean }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map<string, RegExp>();
/** Kurze Muster (≤4 Zeichen) nur als ganzes Wort, längere ab Wortanfang. */
function patternRe(pattern: string): RegExp {
  let re = cache.get(pattern);
  if (!re) {
    const p = esc(upper(pattern));
    re = new RegExp(`(^|[^A-Z0-9])${p}${pattern.trim().length <= 4 ? '($|[^A-Z0-9])' : ''}`);
    cache.set(pattern, re);
  }
  return re;
}

export function ruleMatches(rule: Pick<Rule, 'pattern' | 'field'>, tx: CategorizeInput): boolean {
  if (rule.field === 'merchantKey') return !!tx.merchantKey && tx.merchantKey === rule.pattern;
  const cp = upper(tx.counterpartyName ?? '');
  const pu = upper(tx.purpose ?? '');
  const re = patternRe(rule.pattern);
  if (rule.field === 'counterparty') return re.test(cp);
  if (rule.field === 'purpose') return re.test(pu);
  return re.test(cp) || re.test(pu);
}

/**
 * Eigene Regeln (neueste zuerst) vor eingebauten. Greift keine Regel:
 * Ausgabe → "Sonstiges", Eingang → "Sonstige Einnahmen".
 */
export function categorizeTransaction(tx: CategorizeInput, userRules: Rule[] = []): CategorizeResult {
  const own = [...userRules].sort((a, b) => b.createdAt - a.createdAt);
  for (const r of [...own, ...BUILTIN_RULES]) {
    if (!ruleMatches(r, tx)) continue;
    // Gehalt/Erstattung-Regeln nur für Eingänge, Ausgabe-Regeln nicht für Eingänge (außer Umbuchungen/eigene Regeln)
    const incomeRule = r.categoryId.startsWith('einkommen');
    if (r.builtin && incomeRule && tx.amount < 0) continue;
    if (r.builtin && !incomeRule && r.categoryId !== TRANSFER_CATEGORY && tx.amount > 0 && !isRefund(tx)) continue;
    // Regel ohne Anzeigenamen (z. B. "VERSICHERUNG"): Namen von einer anderen passenden Regel übernehmen
    const merchant = r.merchant ?? BUILTIN_RULES.find(x => x.merchant && ruleMatches(x, tx))?.merchant;
    return { categoryId: r.categoryId, merchant, ruleId: r.id, matched: true };
  }
  return { categoryId: tx.amount < 0 ? UNCATEGORIZED_EXPENSE : UNCATEGORIZED_INCOME, matched: false };
}

/** Gutschrift eines Händlers (Rücksendung) zählt in dessen Kategorie und mindert die Ausgaben. */
function isRefund(tx: CategorizeInput): boolean {
  return /RUECK|ERSTATT|GUTSCHRIFT|STORNO|REFUND/.test(upper(tx.purpose + ' ' + (tx.bookingText ?? '')));
}

/** Art eines Umsatzes anhand der Kategorie. Erstattungen in Ausgabe-Kategorien bleiben "expense" (mindern Ausgaben). */
export function kindFor(categoryKind: TxKind | undefined, amount: number): TxKind {
  if (categoryKind === 'transfer') return 'transfer';
  if (categoryKind === 'income') return 'income';
  if (categoryKind === 'expense') return 'expense';
  return amount < 0 ? 'expense' : 'income';
}
