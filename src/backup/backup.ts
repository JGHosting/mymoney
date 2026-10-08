/**
 * Komplett-Backup als JSON: Export, Prüfung, Migration, Import, Prüfroutine – wie in Basislager.
 *
 * Regeln:
 * - Jede Tabelle der Datenbank muss in BACKUP_TABLES stehen (außer EXCLUDED_TABLES).
 *   Die Prüfroutine schlägt fehl, wenn eine Tabelle fehlt → nichts geht unbemerkt verloren.
 * - Zugangsdaten (FinTS-Brücke) werden bewusst NICHT exportiert (Backup liegt in iCloud/Dateien).
 *   Eine Bank-PIN wird nirgends gespeichert und kann daher auch nicht im Backup landen.
 * - Ein Import schreibt alles in EINER Transaktion: entweder komplett oder gar nicht.
 * - Vor jedem Import wird eine interne Sicherheitskopie angelegt (max. 3).
 */
import Dexie, { type Table } from 'dexie';
import type { Account, Budget, Category, MerchantAlias, MyMoneyDB, Recurring, Rule, SettingRow, SyncLog, Transaction } from '../core/db';
import { db as mainDb, MyMoneyDB as DBClass, setSetting } from '../core/db';

export const SCHEMA_VERSION = 1;
export const BACKUP_TABLES = ['settings', 'accounts', 'transactions', 'categories', 'rules', 'budgets', 'recurring', 'merchants', 'syncLog'] as const;
export const EXCLUDED_TABLES = ['snapshots'];
/** Einstellungen, die nicht ins Backup gehören (Geheimnisse, gerätespezifisch). */
export const EXCLUDED_SETTINGS = new Set(['fintsBridge']);

export type TableName = typeof BACKUP_TABLES[number];
export interface BackupTables {
  settings: SettingRow[]; accounts: Account[]; transactions: Transaction[]; categories: Category[]; rules: Rule[];
  budgets: Budget[]; recurring: Recurring[]; merchants: MerchantAlias[]; syncLog: SyncLog[];
}
export interface BackupFile { app: 'mymoney'; schemaVersion: number; exportedAt: string; tables: BackupTables }

const tablesOf = (d: MyMoneyDB) => BACKUP_TABLES.map(t => d.table(t));

/* ---------- Export ---------- */

export async function exportBackup(d: MyMoneyDB = mainDb): Promise<BackupFile> {
  return d.transaction('r', tablesOf(d), async () => ({
    app: 'mymoney' as const,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables: {
      settings: (await d.settings.toArray()).filter(s => !EXCLUDED_SETTINGS.has(s.key)),
      accounts: await d.accounts.toArray(),
      transactions: await d.transactions.toArray(),
      categories: await d.categories.toArray(),
      rules: await d.rules.toArray(),
      budgets: await d.budgets.toArray(),
      recurring: await d.recurring.toArray(),
      merchants: await d.merchants.toArray(),
      syncLog: await d.syncLog.toArray()
    }
  }));
}

export function backupFileName(ext = 'json', what = 'backup') {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `finanzen-${what}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${ext}`;
}

/* ---------- Prüfen + Migrieren ---------- */

export interface Preview {
  ok: boolean;
  fatal?: string;                    // Datei unbrauchbar → Import nicht möglich
  warnings: string[];                // einzelne fehlerhafte Datensätze (werden übersprungen)
  schemaVersion?: number;
  exportedAt?: string;
  counts: Record<TableName, number>;
  range?: { from: string; to: string };
  data?: BackupFile;                 // bereinigt + migriert, bereit zum Import
}

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown) => typeof v === 'string' && v.length > 0;
const empty = (): Record<TableName, number> => Object.fromEntries(BACKUP_TABLES.map(t => [t, 0])) as Record<TableName, number>;

/** Bringt ältere Backups auf den aktuellen Stand. Für jede Schema-Änderung hier einen Schritt ergänzen. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrate(raw: any): any {
  let v = raw.schemaVersion;
  // Beispiel für künftige Änderungen:
  // if (v < 2) { raw.tables.neueTabelle ??= []; v = 2; }
  if (v < 1) v = 1;
  raw.schemaVersion = v;
  return raw;
}

export function checkBackup(text: string): Preview {
  const fail = (fatal: string): Preview => ({ ok: false, fatal, warnings: [], counts: empty() });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any;
  try { raw = JSON.parse(text); } catch { return fail('Die Datei ist kein gültiges JSON (beschädigt oder falsche Datei).'); }
  if (!raw || raw.app !== 'mymoney') return fail('Das ist kein Backup von „Meine Finanzen“.');
  if (typeof raw.schemaVersion !== 'number') return fail('Im Backup fehlt die Versionsangabe.');
  if (raw.schemaVersion > SCHEMA_VERSION) return fail(`Das Backup stammt aus einer neueren App-Version (${raw.schemaVersion}). Bitte die App erst aktualisieren.`);
  if (!raw.tables || typeof raw.tables !== 'object') return fail('Im Backup fehlen die Daten.');
  const fromVersion = raw.schemaVersion;
  raw = migrate(raw);

  const warnings: string[] = [];
  if (fromVersion < SCHEMA_VERSION) warnings.push(`Backup von Version ${fromVersion} wurde auf Version ${SCHEMA_VERSION} umgewandelt.`);
  for (const t of BACKUP_TABLES) if (!Array.isArray(raw.tables[t])) return fail(`Tabelle „${t}“ fehlt oder ist beschädigt.`);

  const bad: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keep = <T,>(label: string, rows: any[], valid: (r: any) => boolean): T[] =>
    rows.filter(r => { const ok = !!r && typeof r === 'object' && valid(r); if (!ok) bad[label] = (bad[label] ?? 0) + 1; return ok; });

  const tables: BackupTables = {
    settings: keep('Einstellungen', raw.tables.settings, r => typeof r.key === 'string' && !EXCLUDED_SETTINGS.has(r.key)),
    accounts: keep('Konten', raw.tables.accounts, r => isStr(r.id) && isStr(r.provider) && isInt(r.balance)),
    transactions: keep('Umsätze', raw.tables.transactions, r => isStr(r.id) && isStr(r.accountId) && isStr(r.dedupeKey) && isDate(r.bookingDate) && isInt(r.amount) && isStr(r.categoryId)),
    categories: keep('Kategorien', raw.tables.categories, r => isStr(r.id) && isStr(r.name) && isStr(r.kind)),
    rules: keep('Regeln', raw.tables.rules, r => isStr(r.id) && isStr(r.pattern) && isStr(r.categoryId)),
    budgets: keep('Budgets', raw.tables.budgets, r => isStr(r.id) && isStr(r.categoryId) && isInt(r.amount)),
    recurring: keep('Wiederkehrende Zahlungen', raw.tables.recurring, r => isStr(r.id) && isStr(r.key) && isInt(r.amount) && isDate(r.lastDate)),
    merchants: keep('Händlernamen', raw.tables.merchants, r => isStr(r.key) && isStr(r.name)),
    syncLog: keep('Sync-Protokoll', raw.tables.syncLog, r => typeof r.startedAt === 'number')
  };
  for (const [t, n] of Object.entries(bad)) warnings.push(`${n} fehlerhafte(r) Eintrag/Einträge bei ${t} werden übersprungen.`);

  const dates = tables.transactions.map(t => t.bookingDate).sort();
  return {
    ok: true, warnings,
    schemaVersion: fromVersion,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : undefined,
    counts: Object.fromEntries(BACKUP_TABLES.map(t => [t, tables[t].length])) as Record<TableName, number>,
    range: dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : undefined,
    data: { app: 'mymoney', schemaVersion: SCHEMA_VERSION, exportedAt: raw.exportedAt, tables }
  };
}

/* ---------- Import ---------- */

export type ImportMode = 'replace' | 'merge';
export interface ImportResult { added: number; updated: number; unchanged: number }

const newer = (a?: { updatedAt?: number }, b?: { updatedAt?: number }) => (a?.updatedAt ?? 0) > (b?.updatedAt ?? 0);

/**
 * Spielt ein geprüftes Backup ein.
 * replace: alle Daten (außer Zugangsdaten) werden durch das Backup ersetzt.
 * merge:   neue Datensätze kommen dazu; bei gleichen Datensätzen gewinnt der neuere Stand (updatedAt).
 */
export async function importBackup(data: BackupFile, mode: ImportMode, d: MyMoneyDB = mainDb, makeSnapshot = true): Promise<ImportResult> {
  if (makeSnapshot) await createSnapshot(mode === 'replace' ? 'Vor Import (Ersetzen)' : 'Vor Import (Zusammenführen)', d);
  const res: ImportResult = { added: 0, updated: 0, unchanged: 0 };
  // Reine Kopie der Daten (entfernt UI-Proxys, die IndexedDB nicht speichern kann)
  const t: BackupTables = JSON.parse(JSON.stringify(data.tables));

  await d.transaction('rw', tablesOf(d), async () => {
    if (mode === 'replace') {
      const keepSettings = (await d.settings.toArray()).filter(s => EXCLUDED_SETTINGS.has(s.key));
      await Promise.all(BACKUP_TABLES.map(n => d.table(n).clear()));
      await d.settings.bulkPut([...t.settings, ...keepSettings]);
      for (const n of BACKUP_TABLES) if (n !== 'settings') await d.table(n).bulkPut(t[n]);
      res.added = BACKUP_TABLES.reduce((n, k) => n + t[k].length, 0);
      return;
    }
    // Zusammenführen: Einstellungen nur ergänzen, nichts Vorhandenes überschreiben
    for (const s of t.settings) {
      if (await d.settings.get(s.key)) res.unchanged++; else { await d.settings.put(s); res.added++; }
    }
    // Umsätze: gleicher Umsatz = gleicher dedupeKey (auch wenn die eigene ID abweicht)
    const existing = new Map((await d.transactions.toArray()).map(x => [x.dedupeKey, x]));
    const puts: Transaction[] = [];
    for (const x of t.transactions) {
      const e = existing.get(x.dedupeKey);
      if (!e) { puts.push(x); res.added++; }
      else if (newer(x, e)) { puts.push({ ...x, id: e.id, createdAt: e.createdAt }); res.updated++; }
      else res.unchanged++;
    }
    await d.transactions.bulkPut(puts);
    // Wiederkehrend: eindeutig über key
    const recExisting = new Map((await d.recurring.toArray()).map(x => [x.key, x]));
    for (const r of t.recurring) {
      const e = recExisting.get(r.key);
      if (!e) { await d.recurring.put(r); res.added++; }
      else if (newer(r, e)) { await d.recurring.delete(e.id); await d.recurring.put(r); res.updated++; }
      else res.unchanged++;
    }
    // Budgets: eindeutig über Kategorie
    const budExisting = new Map((await d.budgets.toArray()).map(x => [x.categoryId, x]));
    for (const b of t.budgets) {
      const e = budExisting.get(b.categoryId);
      if (!e) { await d.budgets.put(b); res.added++; }
      else if (newer(b, e)) { await d.budgets.delete(e.id); await d.budgets.put(b); res.updated++; }
      else res.unchanged++;
    }
    const mergeByKey = async <T extends { updatedAt?: number }>(table: Table<T, string>, rows: T[], key: (r: T) => string) => {
      for (const r of rows) {
        const e = await table.get(key(r));
        if (!e) { await table.put(r); res.added++; }
        else if (newer(r, e)) { await table.put(r); res.updated++; }
        else res.unchanged++;
      }
    };
    await mergeByKey(d.accounts, t.accounts, r => r.id);
    await mergeByKey(d.categories, t.categories, r => r.id);
    await mergeByKey(d.rules, t.rules, r => r.id);
    await mergeByKey(d.merchants, t.merchants, r => r.key);
    // Protokoll: nur fehlende Einträge (gleiche Startzeit + Anbieter = gleicher Eintrag)
    const logKeys = new Set((await d.syncLog.toArray()).map(l => `${l.provider}|${l.startedAt}`));
    for (const l of t.syncLog) {
      if (logKeys.has(`${l.provider}|${l.startedAt}`)) { res.unchanged++; continue; }
      const { seq: _seq, ...rest } = l;
      await d.syncLog.add(rest); res.added++;
    }
  });
  return res;
}

/* ---------- Sicherheitskopien ---------- */

const MAX_SNAPSHOTS = 3;
export async function createSnapshot(reason: string, d: MyMoneyDB = mainDb) {
  const data = await exportBackup(d);
  await d.snapshots.add({ createdAt: Date.now(), reason, data });
  const all = await d.snapshots.orderBy('createdAt').primaryKeys();
  if (all.length > MAX_SNAPSHOTS) await d.snapshots.bulkDelete(all.slice(0, all.length - MAX_SNAPSHOTS));
}
export async function listSnapshots(d: MyMoneyDB = mainDb) {
  return (await d.snapshots.orderBy('createdAt').reverse().toArray())
    .map(s => ({ seq: s.seq!, createdAt: s.createdAt, reason: s.reason, transactions: (s.data as BackupFile).tables.transactions.length }));
}
export async function restoreSnapshot(seq: number, d: MyMoneyDB = mainDb) {
  const s = await d.snapshots.get(seq);
  if (!s) throw new Error('Sicherheitskopie nicht gefunden.');
  await importBackup(s.data as BackupFile, 'replace', d, true);
}

/* ---------- Prüfroutine (Pflicht-Testfall) ---------- */

/** Stabile Textform eines Backups: Zeilen nach Schlüssel sortiert, Objekt-Schlüssel sortiert, ohne Zeitstempel des Exports. */
export function canonical(b: BackupFile): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortKeys = (v: any): any => Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const key: Record<TableName, (r: any) => string> = {
    settings: r => r.key, accounts: r => r.id, transactions: r => r.id, categories: r => r.id, rules: r => r.id,
    budgets: r => r.id, recurring: r => r.id, merchants: r => r.key, syncLog: r => `${r.provider}|${r.startedAt}`
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tables: any = {};
  for (const t of BACKUP_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (b.tables[t] as any[]).map(r => (t === 'syncLog' ? { ...r, seq: undefined } : r));
    tables[t] = rows.sort((x, y) => key[t](x).localeCompare(key[t](y))).map(sortKeys);
  }
  return JSON.stringify({ schemaVersion: b.schemaVersion, tables });
}

export interface RoundtripResult { ok: boolean; message: string; counts: Record<TableName, number>; ms: number }

/**
 * Export → als Datei-Text serialisieren → in LEERE Test-Datenbank importieren → erneut exportieren → vergleichen.
 * Deine echten Daten werden dabei nicht angefasst.
 */
export async function runRoundtripTest(d: MyMoneyDB = mainDb): Promise<RoundtripResult> {
  const t0 = performance.now();
  const TEST = d.name + '-roundtrip-test';
  const counts = empty();
  // 1. Alle Tabellen abgedeckt?
  const missing = d.tables.map(t => t.name).filter(n => !(BACKUP_TABLES as readonly string[]).includes(n) && !EXCLUDED_TABLES.includes(n));
  if (missing.length) return { ok: false, message: `Tabelle(n) fehlen im Backup: ${missing.join(', ')}`, counts, ms: 0 };

  const before = await exportBackup(d);
  for (const t of BACKUP_TABLES) counts[t] = before.tables[t].length;
  await Dexie.delete(TEST);
  const test = new DBClass(TEST);
  try {
    const preview = checkBackup(JSON.stringify(before));     // wie eine echte Datei
    if (!preview.ok || !preview.data) return { ok: false, message: 'Eigenes Backup nicht lesbar: ' + preview.fatal, counts, ms: 0 };
    if (preview.warnings.length) return { ok: false, message: 'Eigenes Backup enthält fehlerhafte Einträge: ' + preview.warnings.join(' '), counts, ms: 0 };
    await importBackup(preview.data, 'replace', test, false);
    const after = await exportBackup(test);
    const a = canonical(before), b = canonical(after);
    if (a !== b) {
      const only = (x: BackupFile, t: TableName) => canonical({ ...x, tables: { ...Object.fromEntries(BACKUP_TABLES.map(k => [k, []])), [t]: x.tables[t] } as unknown as BackupTables });
      const diff = BACKUP_TABLES.filter(t => only(before, t) !== only(after, t));
      return { ok: false, message: `Unterschiede nach dem Import in: ${diff.join(', ') || 'unbekannt'}`, counts, ms: performance.now() - t0 };
    }
    return { ok: true, message: 'Export und Import sind identisch.', counts, ms: performance.now() - t0 };
  } finally {
    test.close();
    await Dexie.delete(TEST);
  }
}

/* ---------- Teilen / Speichern ---------- */

/** Öffnet das iOS-Teilen-Menü (Dateien, AirDrop …). Fallback: normaler Download. Gibt true zurück, wenn gespeichert. */
export async function shareFile(content: string, name: string, type: string): Promise<boolean> {
  const file = new File([content], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if ((e as Error).name === 'AbortError') return false; /* sonst Fallback */ }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

export async function markBackupDone(d: MyMoneyDB = mainDb) { await setSetting('lastBackupAt', Date.now(), d); }

/* ---------- CSV ---------- */

export function toCsv(rows: Record<string, unknown>[], cols: string[]): string {
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Semikolon + Komma als Dezimaltrenner → öffnet sich in deutschem Excel/Numbers direkt richtig
  return '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))].join('\n');
}

export async function transactionsCsv(d: MyMoneyDB = mainDb) {
  const [txs, cats, accs] = await Promise.all([d.transactions.orderBy('bookingDate').toArray(), d.categories.toArray(), d.accounts.toArray()]);
  const cat = new Map(cats.map(c => [c.id, c.name]));
  const acc = new Map(accs.map(a => [a.id, `${a.bankName} ${a.name}`]));
  const rows = txs.map(t => ({
    Datum: t.bookingDate, Betrag: t.amount / 100, Händler: t.merchant, Kategorie: cat.get(t.categoryId) ?? t.categoryId,
    Konto: acc.get(t.accountId) ?? t.accountId, Verwendungszweck: t.purpose, Gegenkonto: t.counterpartyIban ?? '',
    Notiz: t.notes ?? '', Ignoriert: t.ignored ? 'ja' : ''
  }));
  return toCsv(rows, ['Datum', 'Betrag', 'Händler', 'Kategorie', 'Konto', 'Verwendungszweck', 'Gegenkonto', 'Notiz', 'Ignoriert']);
}
