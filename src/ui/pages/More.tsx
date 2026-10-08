import { Landmark, Repeat, Tags, Settings2, DatabaseBackup, ShieldCheck, Link2, Info } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { fmtAgo } from '../../core/dates';
import { useApp, type Theme } from '../../store/app';
import { useAccounts, useRecurring } from '../hooks/data';
import { Group, GroupLabel, PageTitle, Row, Segmented } from '../components/ui';

const ic = (Icon: typeof Landmark, bg: string) => <span className="grid size-8 place-items-center rounded-[9px] text-white" style={{ background: bg }}><Icon size={18} /></span>;

export default function More() {
  const { theme, setTheme } = useApp();
  const accounts = useAccounts();
  const recurring = useRecurring();
  const lastBackup = useLiveQuery(async () => ((await db.settings.get('lastBackupAt'))?.value as number | undefined) ?? 0, []);
  const providers = useLiveQuery(async () => ((await db.settings.get('providers'))?.value as string[] | undefined) ?? [], []);
  const active = (recurring ?? []).filter(r => r.status !== 'dismissed').length;
  const backupOld = lastBackup != null && (!lastBackup || Date.now() - lastBackup > 30 * 86400000) && (accounts?.length ?? 0) > 0;
  return (
    <>
      <PageTitle title="Mehr" />
      <Group>
        <Row icon={ic(Landmark, 'var(--c1)')} title="Konten" value={accounts?.length || undefined} to="/mehr/konten" />
        <Row icon={ic(Repeat, 'var(--c4)')} title="Fixkosten & Abos" value={active || undefined} to="/mehr/vertraege" />
        <Row icon={ic(Tags, 'var(--c2)')} title="Kategorien & Regeln" to="/mehr/kategorien" />
      </Group>
      <GroupLabel>Darstellung</GroupLabel>
      <Group>
        <div className="px-4 py-3">
          <Segmented<Theme> value={theme} onChange={setTheme} options={[{ value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }, { value: 'system', label: 'System' }]} />
        </div>
      </Group>
      <GroupLabel>Daten</GroupLabel>
      <Group>
        <Row icon={ic(Link2, 'var(--accent)')} title="Bankverbindung" sub={providers?.includes('fints') ? 'VR Bank über FinTS' : providers?.includes('mock') ? 'Demo-Daten aktiv' : 'Nicht verbunden'} to="/mehr/bank" />
        <Row icon={ic(DatabaseBackup, backupOld ? 'var(--warn)' : 'var(--c10)')} title="Backup & Export" sub={lastBackup ? `Letztes Backup ${fmtAgo(lastBackup)}` : 'Noch kein Backup'} to="/mehr/backup" />
        <Row icon={ic(Settings2, 'var(--c10)')} title="Allgemein" to="/mehr/allgemein" />
        <Row icon={ic(ShieldCheck, 'var(--c2)')} title="Datenschutz & Sicherheit" to="/mehr/datenschutz" />
      </Group>
      <GroupLabel>App</GroupLabel>
      <Group>
        <Row icon={ic(Info, 'var(--c10)')} title="Version" value={<span className="tnum text-[15px]">{__APP_VERSION__}</span>} />
        <Row title="Quellcode" value="GitHub" onClick={() => window.open('https://github.com/JGHosting/mymoney', '_blank', 'noopener')} chevron />
      </Group>
    </>
  );
}
