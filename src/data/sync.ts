/**
 * Abgleich mit einer Bank.
 *
 * Erster Sync: Historie der letzten N Monate (Einstellung, Standard 12).
 * Danach: nur neue Umsätze seit dem letzten Sync, mit 14 Tagen Überlappung –
 * nachträglich gebuchte oder geänderte Umsätze werden so ebenfalls erfasst; Duplikate verhindert dedupeKey.
 */
import type { Account, MyMoneyDB, ProviderId } from '../core/db';
import { db as mainDb, getSetting, setSetting } from '../core/db';
import { addDays, addMonthsToDay, today } from '../core/dates';
import { BankError, type SyncPrompter } from '../banking/types';
import { getProvider } from '../banking/registry';
import { importTransactions, loadContext } from './importer';
import { refreshRecurring } from './recurring';

export interface SyncState {
  historyDone: boolean; lastSyncAt?: number; lastSyncDate?: string;
  /** Konten, deren Historie angekommen ist. Fehlt ein Konto, holt der nächste Sync wieder die volle Historie. */
  historyAccounts?: string[];
  /** Fehlversuche (leere Historie) je Konto – nach MAX_EMPTY_HISTORY gilt das Konto als erledigt. */
  emptyHistory?: Record<string, number>;
}
export type SyncStep = 'connect' | 'accounts' | 'transactions' | 'process' | 'categories' | 'done';
export const SYNC_STEP_LABEL: Record<SyncStep, string> = {
  connect: 'Verbindung wird hergestellt …',
  accounts: 'Konten werden geladen …',
  transactions: 'Transaktionen werden geladen …',
  process: 'Transaktionen werden verarbeitet …',
  categories: 'Kategorien werden aktualisiert …',
  done: 'Fertig'
};
export interface SyncResult { added: number; updated: number; accounts: number }

const OVERLAP_DAYS = 14;
/** Ein Konto ohne Umsätze (z. B. Sparkonto) nicht ewig mit voller Historie (= Freigabe) abfragen. */
const MAX_EMPTY_HISTORY = 3;
export const DEFAULT_HISTORY_MONTHS = 12;

export const syncStateKey = (p: ProviderId) => `sync:${p}`;
export async function getSyncState(p: ProviderId, d: MyMoneyDB = mainDb): Promise<SyncState> {
  return (await getSetting<SyncState>(syncStateKey(p), d)) ?? { historyDone: false };
}

/** Aktive Bankanbindungen (z. B. ['mock'] oder ['fints']). */
export async function activeProviders(d: MyMoneyDB = mainDb): Promise<ProviderId[]> {
  return (await getSetting<ProviderId[]>('providers', d)) ?? [];
}
export async function setActiveProviders(list: ProviderId[], d: MyMoneyDB = mainDb) {
  await setSetting('providers', [...new Set(list)], d);
}

export async function runSync(provider: ProviderId, prompter: SyncPrompter, onStep: (s: SyncStep) => void, d: MyMoneyDB = mainDb): Promise<SyncResult> {
  const startedAt = Date.now();
  const p = getProvider(provider);
  const state = await getSyncState(provider, d);
  const end = today();
  const months = (await getSetting<number>('historyMonths', d)) ?? DEFAULT_HISTORY_MONTHS;
  const historyFrom = addMonthsToDay(end, -months);
  const recentFrom = state.historyDone && state.lastSyncDate ? addDays(state.lastSyncDate, -OVERLAP_DAYS) : historyFrom;
  // Alter Stand (vor historyAccounts): alle Konten galten mit historyDone als erledigt.
  const doneAccounts = new Set(state.historyAccounts ?? []);
  const needsHistory = (id: string) => !state.historyDone || (state.historyAccounts !== undefined && !doneAccounts.has(id));
  const emptyHistory = { ...(state.emptyHistory ?? {}) };
  const res: SyncResult = { added: 0, updated: 0, accounts: 0 };
  let loaded: string[] = [];
  try {
    onStep('connect');
    const session = await p.open(prompter);
    try {
      onStep('accounts');
      const accounts = await session.getAccounts();
      const known = new Map((await d.accounts.where('provider').equals(provider).toArray()).map(a => [a.id, a]));
      const total = await d.accounts.count();
      const rows: Account[] = [];
      for (const [i, a] of accounts.entries()) {
        const id = `${provider}:${a.externalId}`;
        const bal = await session.getBalance(a.externalId);
        const prev = known.get(id);
        rows.push({
          id, provider, externalId: a.externalId, name: prev?.name ?? a.name, bankName: a.bankName, type: a.type,
          ...(a.iban ? { iban: a.iban } : {}), currency: a.currency, balance: bal.balance, balanceAt: bal.at,
          ...(prev?.hidden ? { hidden: true } : {}), order: prev?.order ?? total + i,
          createdAt: prev?.createdAt ?? Date.now(), updatedAt: Date.now()
        });
      }
      await d.accounts.bulkPut(rows);
      res.accounts = rows.length;

      onStep('transactions');
      const fetched = [];
      for (const a of rows) {
        const full = needsHistory(a.id);
        const list = await session.getTransactions(a.externalId, full ? historyFrom : recentFrom, end);
        fetched.push({ a, list });
        if (!full) { doneAccounts.add(a.id); continue; }
        // Historie gilt erst als da, wenn wirklich Umsätze kamen (oder nach mehreren leeren Versuchen)
        const tries = (emptyHistory[a.id] ?? 0) + (list.length ? 0 : 1);
        if (list.length || tries >= MAX_EMPTY_HISTORY) { doneAccounts.add(a.id); delete emptyHistory[a.id]; }
        else { doneAccounts.delete(a.id); emptyHistory[a.id] = tries; }
      }

      loaded = fetched.map(({ a, list }) => `${a.name} ${list.length}`);
      onStep('process');
      const ctx = await loadContext(d);
      for (const { a, list } of fetched) {
        const r = await importTransactions(d, a.id, list, ctx);
        res.added += r.added; res.updated += r.updated;
      }
    } finally {
      await session.close();
    }

    onStep('categories');
    await refreshRecurring(d, end);
    await setSetting(syncStateKey(provider), {
      historyDone: true, lastSyncAt: Date.now(), lastSyncDate: end, historyAccounts: [...doneAccounts], emptyHistory
    } satisfies SyncState, d);
    await d.syncLog.add({ provider, startedAt, finishedAt: Date.now(), ok: true, added: res.added, updated: res.updated, message: `${res.added ? `${res.added} neue Umsätze` : 'Keine neuen Umsätze'} · von der Bank: ${loaded.join(', ')}` });
    onStep('done');
    return res;
  } catch (e) {
    const err = e instanceof BankError ? e : new BankError('other', undefined, String(e));
    // Technische Details nur ins lokale Protokoll – nie PIN/TAN (werden nirgends in Fehler geschrieben)
    await d.syncLog.add({ provider, startedAt, finishedAt: Date.now(), ok: false, added: res.added, updated: res.updated, message: err.kind + (err.detail ? `: ${err.detail.slice(0, 200)}` : '') });
    throw err;
  }
}

/** Historie erneut vollständig laden (eigene Änderungen bleiben). */
export async function resetHistory(provider: ProviderId, d: MyMoneyDB = mainDb) {
  const s = await getSyncState(provider, d);
  await setSetting(syncStateKey(provider), { ...s, historyDone: false, historyAccounts: [], emptyHistory: {} }, d);
}

/** Alle Daten eines Anbieters entfernen (z. B. Demo-Daten löschen). */
export async function removeProviderData(provider: ProviderId, d: MyMoneyDB = mainDb) {
  await d.transaction('rw', [d.accounts, d.transactions, d.settings], async () => {
    const ids = (await d.accounts.where('provider').equals(provider).toArray()).map(a => a.id);
    await d.transactions.where('accountId').anyOf(ids).delete();
    await d.accounts.bulkDelete(ids);
    await d.settings.delete(syncStateKey(provider));
    const list = ((await d.settings.get('providers'))?.value as ProviderId[] | undefined) ?? [];
    await d.settings.put({ key: 'providers', value: list.filter(p => p !== provider) });
  });
  await refreshRecurring(d);
}
