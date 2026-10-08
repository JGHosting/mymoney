/** Backup & Export – gleiches Prinzip wie in Basislager. */
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { fmtAgo, fmtDate } from '../../core/dates';
import { BackBar, Button, Card, Group, GroupLabel, PageTitle, Row, cx } from '../components/ui';
import {
  exportBackup, backupFileName, shareFile, markBackupDone, checkBackup, importBackup, runRoundtripTest,
  listSnapshots, restoreSnapshot, transactionsCsv, type Preview, type ImportMode, type RoundtripResult
} from '../../backup/backup';
import { ensureBuiltins } from '../../core/db';
import { useApp } from '../../store/app';

const n = (v: number) => v.toLocaleString('de-DE');

export default function Backup() {
  const lastBackupAt = useLiveQuery(async () => ((await db.settings.get('lastBackupAt'))?.value as number | undefined) ?? 0, []);
  const persist = useApp(s => s.persist);
  const askPersist = useApp(s => s.askPersist);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [test, setTest] = useState<RoundtripResult | null>(null);
  const [snaps, setSnaps] = useState<Awaited<ReturnType<typeof listSnapshots>> | null>(null);
  const [confirmSnap, setConfirmSnap] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const days = lastBackupAt ? Math.floor((Date.now() - lastBackupAt) / 86400000) : null;

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setErr(''); setMsg('');
    try { await fn(); } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };

  return (
    <>
      <BackBar to="/mehr" />
      <PageTitle title="Backup & Export" />
      <Card className="mb-6 p-5">
        <div className={cx('mb-4 rounded-2xl p-3.5', days == null || days > 30 ? 'bg-warn-soft' : 'bg-surface-2')}>
          <div className="font-semibold">{days == null ? 'Noch kein Backup' : days === 0 ? 'Letztes Backup heute' : `Letztes Backup ${fmtAgo(lastBackupAt!)}`}</div>
          <div className="mt-0.5 text-[14px] leading-snug text-ink-2">Deine Finanzdaten liegen nur auf diesem iPhone. Speichere das Backup in der Dateien-App (iCloud Drive) und mach vor iOS-Updates oder einem Gerätewechsel immer ein frisches.</div>
        </div>
        <Button variant="primary" className="w-full" disabled={!!busy} onClick={() => run('export', async () => {
          const b = await exportBackup();
          if (await shareFile(JSON.stringify(b), backupFileName(), 'application/json')) {
            await markBackupDone();
            setMsg(`Backup gespeichert: ${n(b.tables.transactions.length)} Umsätze, ${n(b.tables.accounts.length)} Konten.`);
          }
        })}>{busy === 'export' ? 'Erstelle …' : 'Backup erstellen'}</Button>
        <Button variant="secondary" className="mt-2 w-full" disabled={!!busy} onClick={() => file.current?.click()}>Backup importieren</Button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={async e => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          setErr(''); setMsg(''); setTest(null); setMode('merge');
          setPreview(checkBackup(await f.text()));
        }} />
        {msg && <p className="mt-3 text-[15px] font-medium text-pos" role="status">{msg}</p>}
        {err && <p className="mt-3 text-[15px] font-medium text-neg" role="alert">{err}</p>}
      </Card>

      {preview && (
        <Card className="mb-6 p-5 outline-2 outline-accent">
          <h2 className="mb-2 mt-0 text-[19px] font-semibold">Backup prüfen</h2>
          {!preview.ok ? (
            <>
              <p className="font-medium text-neg">{preview.fatal}</p>
              <p className="text-[14px] text-ink-2">Es wurde nichts verändert.</p>
              <Button className="mt-3 w-full" onClick={() => setPreview(null)}>Schließen</Button>
            </>
          ) : (
            <>
              <div className="divide-y divide-line text-[15px]">
                {preview.exportedAt && <Line k="Erstellt am" v={new Date(preview.exportedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} />}
                <Line k="Umsätze" v={n(preview.counts.transactions)} />
                <Line k="Konten" v={n(preview.counts.accounts)} />
                <Line k="Budgets" v={n(preview.counts.budgets)} />
                <Line k="Wiederkehrende Zahlungen" v={n(preview.counts.recurring)} />
                <Line k="Kategorien / Regeln" v={`${n(preview.counts.categories)} / ${n(preview.counts.rules)}`} />
                {preview.range && <Line k="Zeitraum" v={`${fmtDate(preview.range.from, { day: '2-digit', month: '2-digit', year: 'numeric' })} – ${fmtDate(preview.range.to, { day: '2-digit', month: '2-digit', year: 'numeric' })}`} />}
              </div>
              {preview.warnings.map(w => <p key={w} className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-[14px]">{w}</p>)}
              <div className="mt-4 space-y-2">
                {([['merge', 'Zusammenführen', 'Fehlendes ergänzen. Bei doppelten Einträgen gewinnt der neuere Stand.'], ['replace', 'Alles ersetzen', 'Aktuelle Daten werden durch das Backup ersetzt. Die Bankverbindung bleibt.']] as const).map(([v, t, d]) => (
                  <label key={v} className={cx('flex gap-3 rounded-2xl border p-3', mode === v ? 'border-accent bg-accent-soft' : 'border-line')}>
                    <input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} className="mt-1 accent-[var(--accent)]" />
                    <span><b className="block">{t}</b><span className="text-[14px] text-ink-2">{d}</span></span>
                  </label>
                ))}
              </div>
              <p className="mt-3 text-[14px] text-ink-2">Vorher wird automatisch eine Sicherheitskopie deines aktuellen Stands angelegt.</p>
              <div className="mt-3 flex gap-2">
                <Button variant="primary" className="flex-1" disabled={!!busy} onClick={() => run('import', async () => {
                  try {
                    const r = await importBackup(preview.data!, mode);
                    await ensureBuiltins();
                    setMsg(mode === 'replace' ? `Daten ersetzt: ${n(r.added)} Einträge eingespielt. Eine Sicherheitskopie des alten Stands liegt unten bereit.`
                      : `Zusammengeführt: ${n(r.added)} neu, ${n(r.updated)} aktualisiert, ${n(r.unchanged)} unverändert.`);
                    setPreview(null);
                  } catch (e) { throw new Error('Import abgebrochen, deine Daten sind unverändert. (' + (e as Error).message + ')'); }
                })}>{busy === 'import' ? 'Importiere …' : 'Importieren'}</Button>
                <Button variant="ghost" onClick={() => setPreview(null)}>Abbrechen</Button>
              </div>
            </>
          )}
        </Card>
      )}

      <Group>
        <Row title="Backup-Prüfroutine" value={<span className="text-accent">{busy === 'test' ? 'läuft …' : 'Starten'}</span>} chevron={false}
          onClick={() => run('test', async () => { setTest(await runRoundtripTest()); })} />
        {test && (
          <div className={cx('px-4 py-3 text-[14px]', test.ok ? 'text-pos' : 'text-neg')}>
            {test.ok ? '✓ ' : '✗ '}{test.message}
            {test.ok && <span className="block text-ink-2">{n(test.counts.transactions)} Umsätze, {n(test.counts.accounts)} Konten, {n(test.counts.budgets)} Budgets, {n(test.counts.recurring)} wiederkehrende Zahlungen verglichen · {Math.round(test.ms)} ms</span>}
          </div>
        )}
        <Row title="Umsätze als CSV" value={<span className="text-accent">Teilen</span>} chevron={false} onClick={async () => { await shareFile(await transactionsCsv(), backupFileName('csv', 'umsaetze'), 'text/csv'); }} />
        <Row title="Sicherheitskopien" value={<span className="text-accent">{snaps ? 'Ausblenden' : 'Anzeigen'}</span>} chevron={false} onClick={async () => setSnaps(snaps ? null : await listSnapshots())} />
        {snaps && snaps.length === 0 && <p className="px-4 py-3 text-[14px] text-ink-2">Noch keine. Sie entstehen automatisch vor jedem Import.</p>}
        {snaps?.map(s => (
          <div key={s.seq} className="flex items-center justify-between gap-3 px-4 py-3 text-[14px]">
            <span>{new Date(s.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · {s.reason}<br /><span className="text-ink-2">{n(s.transactions)} Umsätze</span></span>
            {confirmSnap === s.seq
              ? <Button variant="primary" className="min-h-9 px-3 text-[14px]" onClick={() => run('restore', async () => { setConfirmSnap(null); await restoreSnapshot(s.seq); await ensureBuiltins(); setMsg('Sicherheitskopie wiederhergestellt.'); setSnaps(await listSnapshots()); })}>Sicher?</Button>
              : <Button className="min-h-9 px-3 text-[14px]" disabled={!!busy} onClick={() => setConfirmSnap(s.seq)}>Zurück</Button>}
          </div>
        ))}
      </Group>

      <GroupLabel>Speicher</GroupLabel>
      <Group footer="Safari kann Website-Daten bei Speichermangel löschen. Mit dauerhaftem Speicher (und als installierte App auf dem Home-Bildschirm) passiert das nicht ohne Weiteres – ein Backup ersetzt das trotzdem nicht.">
        <Row title="Dauerhafter Speicher" value={persist === 'granted' ? 'Aktiv' : persist === 'unsupported' ? 'Nicht verfügbar' : <span className="text-accent">Anfragen</span>}
          chevron={false} onClick={persist === 'denied' ? () => void askPersist() : undefined} />
      </Group>
    </>
  );
}

const Line = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-3 py-2.5"><span className="text-ink-2">{k}</span><b className="tnum text-right font-medium">{v}</b></div>;
