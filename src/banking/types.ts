/**
 * Bank-Abstraktion. Die App kennt nur diese Schnittstelle – nie die technische Anbindung.
 *
 *   UI → Sync-Service (sync/) → BankingProvider → MockBankingProvider | FinTSProvider → VR Bank
 *                                                 └ später: OpenBankingProvider → Trade Republic
 */
import type { AccountType, ProviderId } from '../core/db';

export interface BankAccountData {
  externalId: string;          // IBAN oder Kontonummer – stabil
  name: string;
  bankName: string;
  type: AccountType;
  iban?: string;
  currency: string;
}

export interface BankBalance { balance: number; at: number }

/** Ein Umsatz, so wie die Bank ihn liefert (Beträge in Cent, negativ = Ausgang). */
export interface BankTransactionData {
  bankRef?: string;
  bookingDate: string;
  valueDate?: string;
  amount: number;
  currency: string;
  counterpartyName?: string;
  counterpartyIban?: string;
  purpose: string;
  bookingText?: string;
  e2eRef?: string;
  mandateRef?: string;
  creditorId?: string;
}

/** Rückfragen an den Nutzer während eines Syncs (PIN, TAN-Freigabe). */
export interface SyncPrompter {
  /** PIN abfragen. Wird nie gespeichert. null = abgebrochen. */
  askPin(bankName: string): Promise<string | null>;
  /** TAN eingeben (chipTAN/smsTAN) oder bei decoupled (SecureGo plus) nur warten. null = abgebrochen. */
  askTan(challenge: TanChallenge): Promise<string | null>;
  /** Hinweis beenden (z. B. Freigabe erkannt). */
  closeTan(): void;
}
export interface TanChallenge { text: string; decoupled: boolean; medium?: string }

export interface ProviderSession {
  getAccounts(): Promise<BankAccountData[]>;
  getBalance(externalId: string): Promise<BankBalance>;
  getTransactions(externalId: string, from: string, to: string): Promise<BankTransactionData[]>;
  close(): Promise<void>;
}

export interface BankingProvider {
  id: ProviderId;
  label: string;
  /** Verbindung aufbauen (Anmeldung, ggf. PIN/TAN). Eine Session pro Sync. */
  open(prompter: SyncPrompter): Promise<ProviderSession>;
}

/** Fehlerklassen mit verständlicher Meldung – Technisches bleibt im Detail und wird nie angezeigt. */
export type BankErrorKind = 'unreachable' | 'auth' | 'fints' | 'cancelled' | 'config' | 'other';
export class BankError extends Error {
  constructor(public kind: BankErrorKind, message?: string, public detail?: string) {
    super(message ?? BANK_ERROR_TEXT[kind]);
  }
}
export const BANK_ERROR_TEXT: Record<BankErrorKind, string> = {
  unreachable: 'Die Bank ist momentan nicht erreichbar. Bitte versuche es später erneut.',
  auth: 'Die Anmeldung bei deiner Bank konnte nicht abgeschlossen werden.',
  fints: 'Die Bankverbindung konnte nicht hergestellt werden.',
  cancelled: 'Synchronisierung abgebrochen.',
  config: 'Die Bankverbindung ist noch nicht eingerichtet.',
  other: 'Bei der Synchronisierung ist ein Fehler aufgetreten.'
};
