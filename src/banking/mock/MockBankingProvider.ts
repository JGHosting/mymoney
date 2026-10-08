/** Demo-Bank mit realistischen Daten. Verhält sich wie eine echte Bank (inkl. kurzer Wartezeiten). */
import type { BankingProvider, ProviderSession } from '../types';
import { today } from '../../core/dates';
import { MOCK_GIRO, MOCK_SAVINGS, balanceAt, range } from './generate';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export function createMockProvider(delayMs = 350): BankingProvider {
  return {
    id: 'mock',
    label: 'Demo-Bank',
    async open(): Promise<ProviderSession> {
      await wait(delayMs);
      return {
        async getAccounts() {
          await wait(delayMs / 2);
          return [
            { externalId: MOCK_GIRO, name: 'Girokonto', bankName: 'VR Bank (Demo)', type: 'giro', iban: MOCK_GIRO, currency: 'EUR' },
            { externalId: MOCK_SAVINGS, name: 'Sparkonto', bankName: 'VR Bank (Demo)', type: 'savings', iban: MOCK_SAVINGS, currency: 'EUR' }
          ];
        },
        async getBalance(id) {
          return { balance: balanceAt(id, today()), at: Date.now() };
        },
        async getTransactions(id, from, to) {
          await wait(delayMs);
          return range(id, from, to > today() ? today() : to);
        },
        async close() { /* nichts zu tun */ }
      };
    }
  };
}
