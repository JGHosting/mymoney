import { useEffect, useState } from 'react';
import { BackBar, Group, GroupLabel, PageTitle, Row, Segmented } from '../components/ui';
import { useApp } from '../../store/app';
import { setSetting } from '../../core/db';
import { INCOME_SHIFT_KEY, useIncomeShiftDay } from '../hooks/data';

const SHIFT_OPTIONS = [
  { value: '0', label: 'Aus' },
  { value: '20', label: 'ab 20.' },
  { value: '25', label: 'ab 25.' },
  { value: '28', label: 'ab 28.' }
];

export default function General() {
  const persist = useApp(s => s.persist);
  const shift = useIncomeShiftDay();
  const [usage, setUsage] = useState<string>('');
  useEffect(() => {
    void navigator.storage?.estimate?.().then(e => { if (e.usage != null) setUsage(`${(e.usage / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`); });
  }, []);
  return (
    <>
      <BackBar to="/mehr" />
      <PageTitle title="Allgemein" />
      <Group>
        <Row title="Währung" value="Euro (€)" />
        <Row title="Sprache" value="Deutsch" />
      </Group>
      <GroupLabel>Einnahmen am Monatsende</GroupLabel>
      <Group footer="Einnahmen ab diesem Tag (z. B. Gehalt am 28.) zählen zum Folgemonat – in Übersicht, Auswertungen und Budgets. In der Umsatzliste bleibt das echte Buchungsdatum. Erstattungen werden nicht verschoben. Etwas Puffer (z. B. „ab 25.“) fängt Wochenenden ab, an denen früher gebucht wird.">
        <div className="px-4 py-3">
          <Segmented value={String(shift ?? 0)} options={SHIFT_OPTIONS} onChange={v => void setSetting(INCOME_SHIFT_KEY, Number(v))} />
        </div>
      </Group>
      <GroupLabel>Gerät</GroupLabel>
      <Group>
        <Row title="Belegter Speicher" value={usage || '–'} />
        <Row title="Dauerhafter Speicher" value={persist === 'granted' ? 'Aktiv' : persist === 'unsupported' ? 'Nicht verfügbar' : 'Nicht aktiv'} />
      </Group>
    </>
  );
}
