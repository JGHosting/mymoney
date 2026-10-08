/**
 * Globaler UI-Zustand (Zustand): Darstellung, Sync-Fortschritt, PIN/TAN-Abfragen, Hinweise.
 * Daten selbst liegen in IndexedDB und werden über useLiveQuery gelesen.
 */
import { create } from 'zustand';
import type { ProviderId } from '../core/db';
import { persistState, requestPersistence, type PersistState, getSetting } from '../core/db';
import { BankError, type SyncPrompter, type TanChallenge } from '../banking/types';
import { activeProviders, runSync, type SyncStep } from '../data/sync';

export type Theme = 'system' | 'light' | 'dark';

interface Prompt { kind: 'pin'; bank: string; resolve: (v: string | null) => void }
interface TanPrompt { kind: 'tan'; challenge: TanChallenge; resolve: (v: string | null) => void }

interface AppState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  persist: PersistState;
  syncing: boolean;
  step: SyncStep | null;
  syncError: string | null;
  lastAdded: number | null;
  prompt: Prompt | TanPrompt | null;
  toast: string | null;
  showToast: (t: string) => void;
  sync: (opts?: { providers?: ProviderId[]; userTriggered?: boolean }) => Promise<void>;
  askPersist: () => Promise<void>;
  init: () => Promise<void>;
}

function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('mm-theme', t); } catch { /* privates Fenster */ }
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#0d1017' : '#f3f4f7'));
}
function readTheme(): Theme {
  try { const t = localStorage.getItem('mm-theme'); if (t === 'light' || t === 'dark') return t; } catch { /* egal */ }
  return 'system';
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const AUTO_SYNC_AFTER_MS = 30 * 60 * 1000;

export const useApp = create<AppState>((set, get) => {
  const prompter: SyncPrompter = {
    askPin: bank => new Promise(resolve => set({ prompt: { kind: 'pin', bank, resolve } })),
    askTan: challenge => new Promise(resolve => set({ prompt: { kind: 'tan', challenge, resolve } })),
    closeTan: () => set(s => (s.prompt?.kind === 'tan' ? { prompt: null } : {}))
  };
  return {
    theme: readTheme(),
    setTheme: t => { applyTheme(t); set({ theme: t }); },
    persist: 'denied',
    syncing: false,
    step: null,
    syncError: null,
    lastAdded: null,
    prompt: null,
    toast: null,
    showToast: t => {
      clearTimeout(toastTimer);
      set({ toast: t });
      toastTimer = setTimeout(() => set({ toast: null }), 2600);
    },
    async sync(opts = {}) {
      if (get().syncing) return;
      const providers = opts.providers ?? (await activeProviders());
      if (!providers.length) return;
      set({ syncing: true, syncError: null, step: 'connect', lastAdded: null });
      // Nach einem Tipp gewährt Safari dauerhaften Speicher eher
      if (opts.userTriggered || get().persist !== 'granted') set({ persist: await requestPersistence() });
      let added = 0;
      try {
        for (const p of providers) added += (await runSync(p, prompter, step => set({ step }))).added;
        set({ lastAdded: added });
      } catch (e) {
        const msg = e instanceof BankError ? e.message : 'Bei der Synchronisierung ist ein Fehler aufgetreten.';
        set({ syncError: e instanceof BankError && e.kind === 'cancelled' ? null : msg });
      } finally {
        set({ syncing: false, prompt: null });
        setTimeout(() => { if (!get().syncing) set({ step: null }); }, 1400);
      }
    },
    async askPersist() { set({ persist: await requestPersistence() }); },
    async init() {
      applyTheme(get().theme);
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(get().theme));
      set({ persist: await persistState() });
      // Demo-Bank automatisch aktualisieren; echte Bank nur auf Wunsch (braucht PIN)
      const auto = async () => {
        const providers = (await activeProviders()).filter(p => p === 'mock');
        if (!providers.length || !navigator.onLine) return;
        const s = await getSetting<{ lastSyncAt?: number }>('sync:mock');
        if (!s?.lastSyncAt || Date.now() - s.lastSyncAt > AUTO_SYNC_AFTER_MS) void get().sync({ providers });
      };
      void auto();
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void auto(); });
    }
  };
});
