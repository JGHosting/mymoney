/** Sync-Zeile: Schrittanzeige während des Abgleichs, sonst "Zuletzt synchronisiert". */
import { RefreshCw, CircleAlert } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { fmtTimestamp } from '../../core/dates';
import { useApp } from '../../store/app';
import { SYNC_STEP_LABEL } from '../../data/sync';
import { cx } from './ui';

export function SyncStatus({ className }: { className?: string }) {
  const { syncing, step, syncError, lastAdded, sync } = useApp();
  const last = useLiveQuery(() => db.syncLog.orderBy('startedAt').reverse().filter(l => l.ok).first(), []);
  const providers = useLiveQuery(async () => ((await db.settings.get('providers'))?.value as string[] | undefined) ?? [], []);
  if (!providers?.length) return null;

  const label = syncing && step ? SYNC_STEP_LABEL[step]
    : step === 'done' ? (lastAdded ? `${lastAdded} neue Umsätze` : 'Alles aktuell')
    : last ? fmtTimestamp(last.finishedAt) : 'Synchronisieren';
  return (
    <div className={className}>
      <button onClick={() => void sync({ userTriggered: true })} disabled={syncing}
        className="press ml-auto flex min-h-9 max-w-[62vw] items-center gap-2 whitespace-nowrap rounded-full bg-surface px-3 text-[13px] font-medium text-ink-2 shadow-[var(--shadow)]" aria-live="polite"
        title="Jetzt synchronisieren" aria-label={`Jetzt synchronisieren. ${label}`}>
        <RefreshCw size={14} className={cx(syncing && 'animate-[spin_0.9s_linear_infinite] text-accent')} />
        <span className="truncate">{label}</span>
      </button>
      {syncError && !syncing && (
        <div className="animate-rise mt-3 flex items-start gap-3 rounded-2xl bg-neg-soft p-3 text-[15px] text-neg" role="alert">
          <CircleAlert size={20} className="mt-0.5 shrink-0" />
          <div className="flex-1">{syncError}</div>
          <button className="font-semibold" onClick={() => void sync({ userTriggered: true })}>Erneut</button>
        </div>
      )}
    </div>
  );
}
