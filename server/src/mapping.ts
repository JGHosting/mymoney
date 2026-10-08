/** Umwandlung der lib-fints-Datentypen in das Format der App (Beträge in Cent, Datum als YYYY-MM-DD). */
import type { AccountBalance, BankAccount, BankAnswer, Statement, Transaction } from 'lib-fints';
import type { AccountType, BankAccountData, BankBalance, BankTransactionData } from './types.js';
import { BridgeError } from './types.js';

/** lib-fints erzeugt Datumswerte in lokaler Zeit des Servers (TZ=Europe/Berlin). */
export const day = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const cents = (v: number): number => Math.round(v * 100);

const TYPE: Record<string, AccountType> = {
  CheckingAccount: 'giro', SavingsAccount: 'savings', FixedDepositAccount: 'savings',
  CreditCardAccount: 'credit', SecuritiesAccount: 'depot', InvestmentCompanyFund: 'depot'
};

export const externalIdOf = (a: BankAccount): string => (a.iban || a.accountNumber + (a.subAccountId ? `-${a.subAccountId}` : '')).replace(/\s/g, '');

export function mapAccount(a: BankAccount, bankName: string): BankAccountData {
  const type = TYPE[a.accountType] ?? 'giro';
  const fallback = { giro: 'Girokonto', savings: 'Sparkonto', credit: 'Kreditkarte', depot: 'Depot' }[type];
  return {
    externalId: externalIdOf(a),
    name: a.product?.trim() || fallback,
    bankName,
    type,
    ...(a.iban ? { iban: a.iban.replace(/\s/g, '') } : {}),
    currency: a.currency || 'EUR'
  };
}

export function mapBalance(b: AccountBalance): BankBalance {
  return { balance: cents(b.balance), at: b.date instanceof Date ? Math.max(b.date.getTime(), 0) : Date.now() };
}

const clean = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim() || undefined;

export function mapTransaction(t: Transaction, currency: string): BankTransactionData {
  const iban = clean(t.remoteAccountNumber);
  // MT940-Referenzen (NONREF, Primanota) sind nicht eindeutig → bewusst keine bankRef; die App nutzt dann den Hash.
  const out: BankTransactionData = {
    bookingDate: day(t.entryDate ?? t.valueDate),
    valueDate: t.valueDate ? day(t.valueDate) : undefined,
    amount: cents(t.amount),
    currency,
    counterpartyName: clean(t.remoteName),
    counterpartyIban: iban && /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban) ? iban : undefined,
    purpose: clean(t.purpose) ?? '',
    bookingText: clean(t.bookingText),
    e2eRef: t.e2eReference && t.e2eReference !== 'NOTPROVIDED' ? clean(t.e2eReference) : undefined,
    mandateRef: clean(t.mandateReference),
    creditorId: clean(t.remoteIdentifier)
  };
  for (const k of Object.keys(out) as (keyof BankTransactionData)[]) if (out[k] === undefined) delete out[k];
  return out;
}

export function mapStatements(statements: Statement[], from: string, to: string): BankTransactionData[] {
  const out: BankTransactionData[] = [];
  for (const s of statements) {
    const currency = s.closingBalance?.currency || s.openingBalance?.currency || 'EUR';
    for (const t of s.transactions) {
      const m = mapTransaction(t, currency);
      if (m.bookingDate >= from && m.bookingDate <= to) out.push(m);
    }
  }
  return out;
}

/**
 * Rückmeldungen der Bank (Codes 9xxx = Fehler) in Fehlerklassen übersetzen.
 * Die Texte stammen von der Bank und enthalten nie PIN oder TAN.
 */
const AUTH_CODES = new Set([9340, 9341, 9342, 9910, 9930, 9931, 9932, 9941, 9942, 9943, 9944]);
export function checkAnswers(answers: BankAnswer[]): void {
  const errors = answers.filter(a => a.code >= 9000);
  if (!errors.length) return;
  const detail = errors.map(a => `${a.code} ${a.text}`).join('; ').slice(0, 300);
  const auth = errors.some(a => AUTH_CODES.has(a.code) || /PIN|gesperrt|Anmeld|Zugang/i.test(a.text));
  throw new BridgeError(auth ? 'auth' : 'fints', auth ? 403 : 502, detail);
}
