/**
 * Lokale Datenbank (IndexedDB über Dexie) – gleiches Prinzip wie Basislager.
 *
 * - Alle Finanzdaten liegen ausschließlich auf diesem Gerät. Kein eigener Server speichert etwas.
 * - Jede Schema-Änderung bekommt eine neue version(n); Dexie migriert alte Stände automatisch.
 * - REGEL: Jede neue Tabelle muss auch in Export/Import (backup/) aufgenommen werden.
 *   Die Backup-Prüfroutine schlägt sonst fehl.
 * - Beträge immer als ganze Cent (siehe core/money.ts).
 */
import Dexie, { type Table } from 'dexie';
import type { Cents } from './money';
import { BUILTIN_CATEGORIES } from '../domain/categories';

export interface SettingRow { key: string; value: unknown }

export type ProviderId = 'mock' | 'fints';
export type AccountType = 'giro' | 'savings' | 'credit' | 'depot';

/** Ein Konto bei einer Bank. Mehrere Banken/Konten sind von Anfang an vorgesehen. */
export interface Account {
  id: string;                  // "<provider>:<externalId>" – stabil über Syncs und Backups
  provider: ProviderId;
  externalId: string;          // IBAN bzw. Kontonummer beim Anbieter
  name: string;                // "Girokonto"
  bankName: string;            // "VR Bank"
  type: AccountType;
  iban?: string;
  currency: string;
  balance: Cents;
  balanceAt: number;           // Zeitpunkt des Saldos (ms)
  hidden?: boolean;            // nicht in Summen
  order: number;
  createdAt: number;
  updatedAt: number;
}

export type TxKind = 'expense' | 'income' | 'transfer';
export type CategorySource = 'rule' | 'manual' | 'none';

export interface Split { categoryId: string; amount: Cents; note?: string }

/** Ein Umsatz. Bankfelder kommen vom Sync, Nutzerfelder bleiben bei jedem Sync erhalten. */
export interface Transaction {
  id: string;
  accountId: string;
  dedupeKey: string;           // eindeutig – verhindert doppelten Import (domain/dedupe.ts)
  bankRef?: string;            // Transaktions-ID der Bank, falls vorhanden
  bookingDate: string;         // "YYYY-MM-DD"
  valueDate?: string;
  amount: Cents;               // negativ = Ausgabe
  currency: string;
  counterpartyName?: string;   // Empfänger bzw. Auftraggeber
  counterpartyIban?: string;
  purpose: string;             // Verwendungszweck
  bookingText?: string;        // "Lastschrift", "Gutschrift", "Kartenzahlung" …
  e2eRef?: string;             // End-to-End-Referenz
  mandateRef?: string;
  creditorId?: string;
  /* --- abgeleitet / vom Nutzer --- */
  merchantKey: string;         // normalisierter Händler (für Regeln, Erkennung)
  merchant: string;            // Anzeigename
  categoryId: string;
  categorySource: CategorySource;
  kind: TxKind;
  recurringId?: string;
  ignored?: boolean;           // nicht in Auswertungen
  notes?: string;
  splits?: Split[];            // aufgeteilt auf mehrere Kategorien (Summe = amount)
  createdAt: number;
  updatedAt: number;
}

export type CategoryColor = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8' | 'c9' | 'c10' | 'c11' | 'c12';
export interface Category {
  id: string;
  name: string;
  parentId?: string;           // Unterkategorie
  kind: TxKind;
  icon: string;                // Name eines Lucide-Icons
  color: CategoryColor;
  order: number;
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Eigene Kategorisierungsregel: Text im Händler/Verwendungszweck → Kategorie. (Eingebaute: domain/rules.ts) */
export interface Rule {
  id: string;
  pattern: string;             // Großbuchstaben, Teiltext
  field: 'any' | 'counterparty' | 'purpose' | 'merchantKey';   // merchantKey = exakt dieser Händler
  categoryId: string;
  merchant?: string;           // schöner Anzeigename ("REWE")
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Budget { id: string; categoryId: string; amount: Cents; createdAt: number; updatedAt: number }

export type Interval = 'weekly' | 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';
/** Wiederkehrende Zahlung (Fixkosten, Abo, Gehalt …) – erkannt oder manuell. */
export interface Recurring {
  id: string;
  key: string;                 // merchantKey + Richtung, eindeutig
  merchant: string;
  categoryId: string;
  amount: Cents;               // typischer Betrag
  interval: Interval;
  lastDate: string;
  nextDate: string;
  count: number;               // Anzahl gefundener Zahlungen
  isSubscription: boolean;
  isFixedCost: boolean;
  status: 'detected' | 'confirmed' | 'dismissed';
  source: 'auto' | 'manual';
  createdAt: number;
  updatedAt: number;
}

/** Eigener Anzeigename für einen Händler (gilt für alle seine Umsätze). */
export interface MerchantAlias { key: string; name: string; updatedAt: number }

export interface SyncLog {
  seq?: number;
  provider: ProviderId;
  startedAt: number;
  finishedAt: number;
  ok: boolean;
  added: number;
  updated: number;
  message: string;
}

/** Interne Sicherheitskopie vor einem Import (wird selbst nicht exportiert). */
export interface Snapshot { seq?: number; createdAt: number; reason: string; data: unknown }

export class MyMoneyDB extends Dexie {
  settings!: Table<SettingRow, string>;
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  categories!: Table<Category, string>;
  rules!: Table<Rule, string>;
  budgets!: Table<Budget, string>;
  recurring!: Table<Recurring, string>;
  merchants!: Table<MerchantAlias, string>;
  syncLog!: Table<SyncLog, number>;
  snapshots!: Table<Snapshot, number>;

  /** name nur für die Backup-Prüfroutine und Tests abweichend (separate Datenbank). */
  constructor(name = 'mymoney') {
    super(name);
    this.version(1).stores({
      settings: 'key',
      accounts: 'id, provider',
      transactions: 'id, &dedupeKey, accountId, bookingDate, categoryId, merchantKey, recurringId',
      categories: 'id, parentId, kind',
      rules: 'id',
      budgets: 'id, &categoryId',
      recurring: 'id, &key, status',
      merchants: 'key',
      syncLog: '++seq, startedAt',
      snapshots: '++seq, createdAt'
    });
    this.on('populate', tx => {
      void tx.table('categories').bulkPut(BUILTIN_CATEGORIES);
    });
  }
}

export const db = new MyMoneyDB();

export async function getSetting<T>(key: string, d: MyMoneyDB = db): Promise<T | undefined> {
  return (await d.settings.get(key))?.value as T | undefined;
}
export async function setSetting(key: string, value: unknown, d: MyMoneyDB = db) {
  await d.settings.put({ key, value });
}
export async function deleteSetting(key: string, d: MyMoneyDB = db) {
  await d.settings.delete(key);
}

/** Fehlende eingebaute Kategorien ergänzen (nach Import oder App-Update). Eigene Änderungen bleiben unberührt. */
export async function ensureBuiltins(d: MyMoneyDB = db) {
  await d.transaction('rw', d.categories, async () => {
    const cats = new Set(await d.categories.toCollection().primaryKeys());
    const missing = BUILTIN_CATEGORIES.filter(c => !cats.has(c.id));
    if (missing.length) await d.categories.bulkPut(missing);
  });
}

export type PersistState = 'granted' | 'denied' | 'unsupported';
/** Bittet den Browser, die Daten nicht automatisch zu löschen. Wirkt am besten nach einem Tipp. */
export async function requestPersistence(): Promise<PersistState> {
  if (!navigator.storage?.persist) return 'unsupported';
  if (await navigator.storage.persisted()) return 'granted';
  return (await navigator.storage.persist()) ? 'granted' : 'denied';
}
export async function persistState(): Promise<PersistState> {
  if (!navigator.storage?.persisted) return 'unsupported';
  return (await navigator.storage.persisted()) ? 'granted' : 'denied';
}
