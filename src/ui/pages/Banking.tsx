/** Bankverbindungen: Demo-Daten, VR Bank über FinTS (Brücke), Historie, Sync-Protokoll. */
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FlaskConical, Landmark, CircleCheck, CircleAlert } from 'lucide-react';
import { db, getSetting, setSetting, deleteSetting } from '../../core/db';
import { fmtTimestamp } from '../../core/dates';
import { BackBar, Button, Card, Group, GroupLabel, PageTitle, Row, Segmented, cx } from '../components/ui';
import { activeProviders, setActiveProviders, removeProviderData, resetHistory, DEFAULT_HISTORY_MONTHS } from '../../data/sync';
import type { BridgeConfig } from '../../banking/fints/FinTSProvider';
import { useApp } from '../../store/app';

export default function Banking() {
  const providers = useLiveQuery(async () => ((await db.settings.get('providers'))?.value as string[] | undefined) ?? [], []);
  const months = useLiveQuery(async () => ((await db.settings.get('historyMonths'))?.value as number | undefined) ?? DEFAULT_HISTORY_MONTHS, []);
  const log = useLiveQuery(() => db.syncLog.orderBy('startedAt').reverse().limit(8).toArray(), []);
  const { sync, syncing, showToast } = useApp();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const demo = providers?.includes('mock');
  const fints = providers?.includes('fints');

  const enable = async (p: 'mock' | 'fints') => {
    await setActiveProviders([...(await activeProviders()), p]);
    await sync({ providers: [p], userTriggered: true });
  };

  return (
    <>
      <BackBar to="/mehr" />
      <PageTitle title="Bankverbindung" />

      <GroupLabel>VR Bank</GroupLabel>
      <FinTSCard active={!!fints} onEnable={() => void enable('fints')} />

      <GroupLabel>Demo</GroupLabel>
      <Group footer="Realistische Beispielumsätze der letzten 12 Monate – ideal zum Ausprobieren. Sie liegen getrennt von echten Bankdaten und lassen sich vollständig entfernen.">
        <Row icon={<span className="grid size-8 place-items-center rounded-[9px] bg-surface-2 text-ink-2"><FlaskConical size={18} /></span>} title="Demo-Daten" value={demo ? 'Aktiv' : 'Aus'} chevron={false} />
        {!demo ? <Row title={<span className="text-accent">{syncing ? 'Lade …' : 'Demo-Daten laden'}</span>} onClick={() => void enable('mock')} chevron={false} />
          : confirmRemove
            ? <Row title={<span className="font-semibold text-neg">Wirklich alle Demo-Daten entfernen?</span>} onClick={async () => { await removeProviderData('mock'); setConfirmRemove(false); showToast('Demo-Daten entfernt'); }} chevron={false} />
            : <Row title={<span className="text-neg">Demo-Daten entfernen</span>} onClick={() => setConfirmRemove(true)} chevron={false} />}
      </Group>

      <GroupLabel>Erster Abruf</GroupLabel>
      <Group footer="So weit reicht der erste Abruf zurück. Danach werden nur neue Umsätze geladen. Viele Banken verlangen für Umsätze älter als 90 Tage eine zusätzliche Freigabe.">
        <div className="px-4 py-3">
          <Segmented value={String(months ?? 12)} onChange={v => void setSetting('historyMonths', Number(v))}
            options={[{ value: '3', label: '3 Monate' }, { value: '6', label: '6 Monate' }, { value: '12', label: '12 Monate' }, { value: '24', label: '24 Monate' }]} />
        </div>
        {(providers?.length ?? 0) > 0 && (
          <Row title={<span className="text-accent">Historie neu laden</span>} chevron={false} onClick={async () => {
            for (const p of await activeProviders()) await resetHistory(p);
            await sync({ userTriggered: true });
          }} />
        )}
      </Group>

      {log && log.length > 0 && (
        <>
          <GroupLabel>Protokoll</GroupLabel>
          <Group>
            {log.map(l => (
              <Row key={l.seq} icon={l.ok ? <CircleCheck size={20} className="text-pos" /> : <CircleAlert size={20} className="text-neg" />}
                title={<span className="text-[15px]">{l.ok ? l.message : 'Fehlgeschlagen'}</span>}
                sub={`${l.provider === 'mock' ? 'Demo' : 'VR Bank'} · ${fmtTimestamp(l.finishedAt)}${l.ok ? '' : ` · ${l.message}`}`} />
            ))}
          </Group>
        </>
      )}
    </>
  );
}

function FinTSCard({ active, onEnable }: { active: boolean; onEnable: () => void }) {
  const [cfg, setCfg] = useState<BridgeConfig>({ url: '', token: '' });
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<'' | 'ok' | 'fail' | 'run'>('');
  useEffect(() => { void getSetting<BridgeConfig>('fintsBridge').then(c => { if (c) { setCfg(c); setSaved(true); } }); }, []);
  const save = async () => { await setSetting('fintsBridge', { url: cfg.url.trim(), token: cfg.token.trim() }); setSaved(true); };
  const check = async () => {
    setTest('run');
    try {
      const r = await fetch(cfg.url.replace(/\/+$/, '') + '/api/health', { headers: { Authorization: `Bearer ${cfg.token}` } });
      setTest(r.ok ? 'ok' : 'fail');
    } catch { setTest('fail'); }
  };
  return (
    <Card className="mb-6 p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent"><Landmark size={20} /></span>
        <div>
          <div className="font-semibold">VR Bank über FinTS</div>
          <div className="text-[13px] text-ink-2">{active ? 'Verbunden – PIN wird bei jedem Abruf abgefragt' : 'Direkt über die offizielle Bankschnittstelle'}</div>
        </div>
      </div>
      <p className="mb-4 text-[14px] leading-snug text-ink-2">
        Die App spricht über deine eigene, kleine FinTS-Brücke mit der Bank (Server auf eigener Infrastruktur). Die Brücke speichert keine Umsätze und keine PIN. Bankleitzahl und Anmeldename liegen dort in der Konfiguration.
      </p>
      <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="bridge-url">Adresse der FinTS-Brücke</label>
      <input id="bridge-url" value={cfg.url} onChange={e => { setCfg({ ...cfg, url: e.target.value }); setSaved(false); }} placeholder="https://finanzen.example.de" inputMode="url" autoCapitalize="off" autoCorrect="off"
        className="mb-3 w-full rounded-2xl border border-line bg-bg px-4 py-3 outline-none focus:border-accent" />
      <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="bridge-token">Zugangsschlüssel der Brücke</label>
      <input id="bridge-token" type="password" value={cfg.token} onChange={e => { setCfg({ ...cfg, token: e.target.value }); setSaved(false); }} autoComplete="off"
        className="mb-2 w-full rounded-2xl border border-line bg-bg px-4 py-3 outline-none focus:border-accent" />
      <p className="mb-4 text-[13px] text-ink-2">Wird nur auf diesem Gerät gespeichert und nie ins Backup übernommen. Nicht deine Bank-PIN.</p>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={!cfg.url || !cfg.token || saved} onClick={() => void save()}>{saved ? 'Gespeichert' : 'Speichern'}</Button>
        <Button className="flex-1" disabled={!saved || test === 'run'} onClick={() => void check()}>{test === 'run' ? 'Prüfe …' : 'Verbindung testen'}</Button>
      </div>
      {test === 'ok' && <p className="mt-3 text-[14px] font-medium text-pos">Brücke erreichbar.</p>}
      {test === 'fail' && <p className="mt-3 text-[14px] font-medium text-neg">Die Brücke ist nicht erreichbar. Prüfe Adresse und Zugangsschlüssel.</p>}
      {!active
        ? <Button variant="primary" className="mt-3 w-full" disabled={!saved} onClick={onEnable}>Verbinden & synchronisieren</Button>
        : <Button variant="ghost" className={cx('mt-2 w-full text-neg')} onClick={async () => { await setActiveProviders((await activeProviders()).filter(p => p !== 'fints')); await deleteSetting('sync:fints'); }}>Verbindung trennen (Umsätze bleiben)</Button>}
    </Card>
  );
}
