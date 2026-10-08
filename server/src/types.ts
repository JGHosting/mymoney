/** Datenformate des API-Vertrags – identisch zu src/banking/types.ts der App. */
export type AccountType = 'giro' | 'savings' | 'credit' | 'depot';
export interface BankAccountData { externalId: string; name: string; bankName: string; type: AccountType; iban?: string; currency: string }
export interface BankBalance { balance: number; at: number }
export interface BankTransactionData {
  bankRef?: string; bookingDate: string; valueDate?: string; amount: number; currency: string;
  counterpartyName?: string; counterpartyIban?: string; purpose: string; bookingText?: string;
  e2eRef?: string; mandateRef?: string; creditorId?: string;
}
export interface TanChallenge { text: string; decoupled: boolean; medium?: string }
export type BankErrorKind = 'unreachable' | 'auth' | 'fints' | 'cancelled' | 'config' | 'other';

export class BridgeError extends Error {
  constructor(public kind: BankErrorKind, public status: number, public detail?: string) { super(kind); }
}
