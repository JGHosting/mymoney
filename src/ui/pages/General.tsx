import { useEffect, useState } from 'react';
import { BackBar, Group, GroupLabel, PageTitle, Row } from '../components/ui';
import { useApp } from '../../store/app';

export default function General() {
  const persist = useApp(s => s.persist);
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
        <Row title="Monat beginnt am" value="1. des Monats" />
      </Group>
      <GroupLabel>Gerät</GroupLabel>
      <Group>
        <Row title="Belegter Speicher" value={usage || '–'} />
        <Row title="Dauerhafter Speicher" value={persist === 'granted' ? 'Aktiv' : persist === 'unsupported' ? 'Nicht verfügbar' : 'Nicht aktiv'} />
      </Group>
    </>
  );
}
