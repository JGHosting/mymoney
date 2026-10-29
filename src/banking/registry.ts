/** Alle verfügbaren Bankanbindungen. Neue Anbieter (z. B. Trade Republic) werden nur hier ergänzt. */
import type { ProviderId } from '../core/db';
import { getSetting, setSetting } from '../core/db';
import type { BankingProvider } from './types';
import { createMockProvider } from './mock/MockBankingProvider';
import { createFinTSProvider, type BridgeConfig } from './fints/FinTSProvider';
import { pinMemory } from './pinStore';

const providers: Record<ProviderId, BankingProvider> = {
  mock: createMockProvider(),
  fints: createFinTSProvider(() => getSetting<BridgeConfig>('fintsBridge'), {
    load: () => getSetting<string>('fintsState'),
    save: s => setSetting('fintsState', s)
  }, pinMemory)
};

export const getProvider = (id: ProviderId): BankingProvider => providers[id];
/** Nur für Tests: Anbieter austauschen. */
export function setProvider(p: BankingProvider) { providers[p.id] = p; }
