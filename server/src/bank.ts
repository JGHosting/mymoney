/**
 * Eine Bank-Sitzung pro Sync. Hält den FinTS-Client (inkl. PIN) nur im Arbeitsspeicher und nur so lange,
 * bis die App die Sitzung schließt oder sie nach SESSION_TTL abläuft.
 *
 * Gespeichert wird auf der Festplatte ausschließlich die "Banking Information" (BPD/UPD/System-ID),
 * damit die Bank uns beim nächsten Mal wiedererkennt – keine PIN, keine Umsätze.
 */
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FinTSClient, FinTSConfig } from 'lib-fints';
import type { AccountBalanceResponse, BankAccount, BankingInformation, ClientResponse, StatementResponse, SynchronizeResponse } from 'lib-fints';
import type { BridgeConfig } from './config.js';
import type { BankAccountData, BankBalance, BankTransactionData, TanChallenge } from './types.js';
import { BridgeError } from './types.js';
import { checkAnswers, externalIdOf, mapAccount, mapBalance, mapStatements } from './mapping.js';

/** Teilmenge von FinTSClient, die wir nutzen (für Tests austauschbar). */
export interface FinTSLike {
  config: {
    bankingInformation: BankingInformation;
    availableTanMethods: { id: number; name: string; isDecoupled: boolean; activeTanMedia: string[]; tanMediaRequirement: number }[];
    selectedTanMethod?: { id: number; name: string; isDecoupled: boolean };
  };
  selectTanMethod(id: number): unknown;
  selectTanMedia(name: string): void;
  synchronize(): Promise<SynchronizeResponse>;
  synchronizeWithTan(ref: string, tan?: string): Promise<SynchronizeResponse>;
  getAccountBalance(a: BankAccount): Promise<AccountBalanceResponse>;
  getAccountBalanceWithTan(ref: string, tan?: string): Promise<AccountBalanceResponse>;
  getAccountStatements(a: BankAccount, from?: Date, to?: Date): Promise<StatementResponse>;
  getAccountStatementsWithTan(ref: string, tan?: string): Promise<StatementResponse>;
}

interface Saved { info: BankingInformation; tanMethodId?: number; tanMedia?: string }
export type ClientFactory = (cfg: BridgeConfig, pin: string, saved?: Saved) => FinTSLike;

export const defaultFactory: ClientFactory = (cfg, pin, saved) => {
  const config = saved
    ? FinTSConfig.fromBankingInformation(cfg.productId, cfg.productVersion, saved.info, cfg.user, pin, saved.tanMethodId, saved.tanMedia)
    : FinTSConfig.forFirstTimeUse(cfg.productId, cfg.productVersion, cfg.fintsUrl, cfg.blz, cfg.user, pin);
  config.debugEnabled = false;   // niemals Nachrichten (mit PIN) protokollieren
  return new FinTSClient(config) as unknown as FinTSLike;
};

type Pending =
  | { kind: 'sync'; ref: string }
  | { kind: 'balance'; ref: string; ext: string }
  | { kind: 'statements'; ref: string; key: string; from: string; to: string };

/** Netzwerkfehler (Bank nicht erreichbar) von FinTS-Fehlern unterscheiden. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof BridgeError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|network|socket/i.test(msg)) throw new BridgeError('unreachable', 504, msg.slice(0, 200));
    throw new BridgeError('fints', 502, msg.slice(0, 200));
  }
}

export class BankSession {
  pending: Pending | null = null;
  private results = new Map<string, BankTransactionData[]>();
  private balances = new Map<string, BankBalance>();
  lastUsed = Date.now();

  constructor(private cfg: BridgeConfig, private client: FinTSLike, private bankName: string, private store: InfoStore) {}

  static async open(cfg: BridgeConfig, pin: string, store: InfoStore, factory: ClientFactory = defaultFactory): Promise<BankSession> {
    if (!pin || pin.length > 64) throw new BridgeError('auth', 400, 'PIN fehlt');
    const saved = store.load();
    const client = factory(cfg, pin, saved);
    const s = new BankSession(cfg, client, 'VR Bank', store);
    await s.start(!saved);
    return s;
  }

  /** Synchronisieren; beim ersten Mal TAN-Verfahren wählen und erneut synchronisieren (liefert erst dann die Konten). */
  private async start(firstTime: boolean) {
    let r = await guard(() => this.client.synchronize());
    checkAnswers(r.bankAnswers);
    if (firstTime || !this.client.config.selectedTanMethod || !this.client.config.bankingInformation.upd) {
      this.chooseTanMethod();
      if (!r.requiresTan) { r = await guard(() => this.client.synchronize()); checkAnswers(r.bankAnswers); }
    }
    this.lastChallenge = r.tanChallenge ?? '';
    this.afterResponse(r, { kind: 'sync', ref: r.tanReference ?? '' });
    if (!r.requiresTan) this.persist();
  }

  private chooseTanMethod() {
    const methods = this.client.config.availableTanMethods;
    if (!methods.length) throw new BridgeError('fints', 502, 'Die Bank bietet kein TAN-Verfahren an.');
    // Bevorzugt: fest konfiguriert → entkoppelt (VR SecureGo plus) → erstes verfügbares
    const m = methods.find(x => x.id === this.cfg.tanMethodId) ?? methods.find(x => x.isDecoupled) ?? methods[0]!;
    this.client.selectTanMethod(m.id);
    if (m.tanMediaRequirement === 2 && m.activeTanMedia.length) this.client.selectTanMedia(this.cfg.tanMedia ?? m.activeTanMedia[0]!);
  }

  private afterResponse(r: ClientResponse, pending: Pending) {
    this.lastUsed = Date.now();
    if (!r.success && !r.requiresTan) checkAnswers(r.bankAnswers.length ? r.bankAnswers : [{ code: 9999, text: 'Auftrag nicht ausgeführt' }]);
    this.pending = r.requiresTan ? { ...pending, ref: r.tanReference ?? '' } as Pending : null;
  }

  /** TAN-Abfrage für die App, wenn gerade eine Freigabe aussteht. */
  challenge(): TanChallenge | undefined {
    if (!this.pending) return undefined;
    const m = this.client.config.selectedTanMethod;
    return { text: this.lastChallenge || 'Bitte gib den Auftrag frei.', decoupled: !!m?.isDecoupled, ...(m?.name ? { medium: m.name } : {}) };
  }
  private lastChallenge = '';

  /** TAN senden bzw. (entkoppelt) nachfragen, ob freigegeben wurde. */
  async submitTan(tan?: string): Promise<{ ok: true } | { pending: true }> {
    const p = this.pending;
    if (!p) return { ok: true };
    const t = tan?.trim() || undefined;
    if (p.kind === 'sync') {
      const r = await guard(() => this.client.synchronizeWithTan(p.ref, t));
      checkAnswers(r.bankAnswers);
      if (r.requiresTan) { this.pending = { ...p, ref: r.tanReference ?? p.ref }; return { pending: true }; }
      this.pending = null; this.persist();
      if (!this.client.config.bankingInformation.upd) { const r2 = await guard(() => this.client.synchronize()); checkAnswers(r2.bankAnswers); this.persist(); }
      return { ok: true };
    }
    if (p.kind === 'balance') {
      const r = await guard(() => this.client.getAccountBalanceWithTan(p.ref, t));
      checkAnswers(r.bankAnswers);
      if (r.requiresTan) { this.pending = { ...p, ref: r.tanReference ?? p.ref }; return { pending: true }; }
      if (r.balance) this.balances.set(p.ext, mapBalance(r.balance));
      this.pending = null; return { ok: true };
    }
    const r = await guard(() => this.client.getAccountStatementsWithTan(p.ref, t));
    checkAnswers(r.bankAnswers);
    if (r.requiresTan) { this.pending = { ...p, ref: r.tanReference ?? p.ref }; return { pending: true }; }
    this.results.set(p.key, mapStatements(r.statements ?? [], p.from, p.to));
    this.pending = null;
    return { ok: true };
  }

  private accountsRaw(): BankAccount[] {
    const accs = this.client.config.bankingInformation.upd?.bankAccounts ?? [];
    return accs.filter(a => a.accountType !== 'SecuritiesAccount' || !!a.iban);
  }
  private find(ext: string): BankAccount {
    const a = this.accountsRaw().find(x => externalIdOf(x) === ext);
    if (!a) throw new BridgeError('other', 404, 'Konto nicht gefunden');
    return a;
  }

  accounts(): BankAccountData[] {
    this.lastUsed = Date.now();
    return this.accountsRaw().map(a => mapAccount(a, this.bankName));
  }

  async balance(ext: string): Promise<BankBalance | { tan: TanChallenge }> {
    const cached = this.balances.get(ext);
    if (cached) return cached;
    const r = await guard(() => this.client.getAccountBalance(this.find(ext)));
    this.lastChallenge = r.tanChallenge ?? '';
    this.afterResponse(r, { kind: 'balance', ref: '', ext });
    if (r.requiresTan) return { tan: this.challenge()! };
    checkAnswers(r.bankAnswers);
    if (!r.balance) throw new BridgeError('fints', 502, 'Die Bank hat keinen Saldo geliefert.');
    const b = mapBalance(r.balance);
    this.balances.set(ext, b);
    return b;
  }

  async transactions(ext: string, from: string, to: string): Promise<BankTransactionData[] | { tan: TanChallenge }> {
    const key = `${ext}|${from}|${to}`;
    const cached = this.results.get(key);
    if (cached) return cached;
    const [fy, fm, fd] = from.split('-').map(Number), [ty, tm, td] = to.split('-').map(Number);
    const r = await guard(() => this.client.getAccountStatements(this.find(ext), new Date(fy!, fm! - 1, fd!), new Date(ty!, tm! - 1, td!)));
    this.lastChallenge = r.tanChallenge ?? '';
    this.afterResponse(r, { kind: 'statements', ref: '', key, from, to });
    if (r.requiresTan) return { tan: this.challenge()! };
    checkAnswers(r.bankAnswers);
    const list = mapStatements(r.statements ?? [], from, to);
    this.results.set(key, list);
    return list;
  }

  private persist() {
    const m = this.client.config.selectedTanMethod;
    this.store.save({ info: this.client.config.bankingInformation, ...(m ? { tanMethodId: m.id } : {}), ...(this.cfg.tanMedia ? { tanMedia: this.cfg.tanMedia } : {}) });
  }
}

/** Ablage der Banking Information (keine Geheimnisse) mit Dateirechten 600. */
export class InfoStore {
  private file: string;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = join(dir, 'banking-info.json');
  }
  load(): Saved | undefined {
    if (!existsSync(this.file)) return undefined;
    try { return JSON.parse(readFileSync(this.file, 'utf8')) as Saved; } catch { return undefined; }
  }
  save(s: Saved) {
    writeFileSync(this.file, JSON.stringify(s), { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }
}
