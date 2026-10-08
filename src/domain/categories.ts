/** Eingebaute Kategorien. IDs sind stabil (werden in Regeln, Budgets und Backups referenziert). */
import type { Category, CategoryColor, TxKind } from '../core/db';

type Def = [id: string, name: string, icon: string, color: CategoryColor, kind: TxKind, children?: [string, string, string][]];

const DEFS: Def[] = [
  ['wohnen', 'Wohnen', 'home', 'c1', 'expense', [
    ['miete', 'Miete', 'key-round'], ['nebenkosten', 'Nebenkosten', 'receipt'], ['strom', 'Strom', 'zap'], ['internet', 'Internet & Mobilfunk', 'wifi']]],
  ['lebensmittel', 'Lebensmittel', 'shopping-basket', 'c2', 'expense', [
    ['supermarkt', 'Supermarkt', 'shopping-basket'], ['restaurants', 'Restaurants & Cafés', 'utensils'], ['lieferdienste', 'Lieferdienste', 'bike']]],
  ['mobilitaet', 'Mobilität', 'car', 'c3', 'expense', [
    ['auto', 'Auto', 'car'], ['tanken', 'Tanken', 'fuel'], ['oepnv', 'ÖPNV & Bahn', 'train-front'], ['taxi', 'Taxi & Sharing', 'car-taxi-front']]],
  ['freizeit', 'Freizeit', 'mountain', 'c4', 'expense', [
    ['streaming', 'Streaming', 'tv'], ['digital', 'Apps & Cloud', 'cloud'], ['gaming', 'Gaming', 'gamepad-2'], ['kino', 'Kino & Kultur', 'clapperboard'],
    ['sport', 'Sport & Fitness', 'dumbbell'], ['hobbys', 'Hobbys', 'palette']]],
  ['shopping', 'Shopping', 'shopping-bag', 'c5', 'expense', [
    ['kleidung', 'Kleidung', 'shirt'], ['elektronik', 'Elektronik', 'smartphone'], ['haushalt', 'Haushalt', 'sofa'], ['online', 'Online-Handel', 'package']]],
  ['gesundheit', 'Gesundheit', 'heart-pulse', 'c6', 'expense', [
    ['apotheke', 'Apotheke', 'pill'], ['arzt', 'Arzt', 'stethoscope'], ['drogerie', 'Drogerie', 'sparkles']]],
  ['versicherungen', 'Versicherungen', 'shield-check', 'c7', 'expense'],
  ['reisen', 'Reisen', 'plane', 'c8', 'expense'],
  ['bargeld', 'Bargeld', 'banknote', 'c11', 'expense'],
  ['sonstiges', 'Sonstiges', 'circle-dashed', 'c12', 'expense'],
  ['einkommen', 'Einkommen', 'wallet', 'c9', 'income', [
    ['gehalt', 'Gehalt', 'briefcase'], ['erstattungen', 'Erstattungen', 'undo-2'], ['sonstiges', 'Sonstige Einnahmen', 'plus']]],
  ['sparen', 'Sparen & Umbuchungen', 'arrow-left-right', 'c10', 'transfer']
];

export const BUILTIN_CATEGORIES: Category[] = DEFS.flatMap(([id, name, icon, color, kind, children], i) => [
  { id, name, icon, color, kind, order: i * 100, builtin: true, createdAt: 0, updatedAt: 0 },
  ...(children ?? []).map(([cid, cname, cicon], j) => ({
    id: `${id}.${cid}`, name: cname, icon: cicon, color, kind, parentId: id, order: i * 100 + j + 1, builtin: true, createdAt: 0, updatedAt: 0
  }))
]);

/** Fallback, wenn keine Regel greift. */
export const UNCATEGORIZED_EXPENSE = 'sonstiges';
export const UNCATEGORIZED_INCOME = 'einkommen.sonstiges';
export const TRANSFER_CATEGORY = 'sparen';

/** Oberkategorie einer Kategorie-ID ("lebensmittel.supermarkt" → "lebensmittel"). */
export function rootOf(categoryId: string, cats?: Map<string, Category>): string {
  const c = cats?.get(categoryId);
  if (c) return c.parentId ?? c.id;
  return categoryId.split('.')[0] ?? categoryId;
}
