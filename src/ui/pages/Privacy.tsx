import { ShieldCheck } from 'lucide-react';
import { BackBar, Card, PageTitle } from '../components/ui';

const POINTS: [string, string][] = [
  ['Alles bleibt auf diesem Gerät', 'Umsätze, Konten, Budgets und Kategorien liegen ausschließlich lokal im Speicher dieses iPhones (IndexedDB). Es gibt keinen Cloud-Dienst und kein Konto.'],
  ['Keine Bank-PIN gespeichert', 'Die PIN wird bei jedem Abruf abgefragt, nur für diese eine Verbindung genutzt und nirgends abgelegt – nicht im Gerät, nicht im Backup, nicht auf der Brücke.'],
  ['Eigene FinTS-Brücke', 'Die Bankverbindung läuft über einen kleinen Server auf deiner eigenen Infrastruktur. Er reicht Anfragen nur durch und speichert keine Umsätze. Der Zugangsschlüssel bleibt auf diesem Gerät.'],
  ['Kein Tracking', 'Keine Werbung, keine Analysedienste, keine externen Schriftarten oder SDKs. Die App lädt nichts von Dritten nach.'],
  ['Backups liegen bei dir', 'Ein Backup ist eine JSON-Datei, die du selbst speicherst (z. B. iCloud Drive). Zugangsdaten werden nie mit exportiert.'],
  ['Quellcode ohne Geheimnisse', 'Im Repository liegen keine Daten und keine Schlüssel. Konfiguration erfolgt über Umgebungsvariablen der Brücke.']
];

export default function Privacy() {
  return (
    <>
      <BackBar to="/mehr" />
      <PageTitle title="Datenschutz" />
      <Card className="p-5">
        <ShieldCheck size={28} className="mb-3 text-pos" />
        {POINTS.map(([t, d]) => (
          <div key={t} className="mb-4 last:mb-0">
            <div className="font-semibold">{t}</div>
            <p className="m-0 mt-0.5 text-[15px] leading-snug text-ink-2">{d}</p>
          </div>
        ))}
      </Card>
    </>
  );
}
