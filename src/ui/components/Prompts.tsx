/** PIN- und TAN-Abfrage während eines Syncs. Die PIN wird nur gemerkt, wenn „PIN merken“ eingeschaltet ist (banking/pinStore.ts). */
import { useEffect, useRef, useState } from 'react';
import { ScanFace, Smartphone } from 'lucide-react';
import { getPinMode, hasCred, hasVault, storePin, unlockPin, type PinMode } from '../../banking/pinStore';
import { useApp } from '../../store/app';
import { Sheet } from './Sheet';
import { Button } from './ui';

export function Prompts() {
  const prompt = useApp(s => s.prompt);
  const [value, setValue] = useState('');
  if (!prompt) return null;
  const close = (v: string | null) => { prompt.resolve(v); setValue(''); useApp.setState({ prompt: null }); };

  if (prompt.kind === 'pin') return <PinSheet bank={prompt.bank} onDone={close} value={value} setValue={setValue} />;
  const { challenge } = prompt;
  return (
    <Sheet open onClose={() => close(null)} title="Freigabe erforderlich">
      <div className="pb-2">
        {challenge.decoupled ? (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="mb-4 grid size-16 place-items-center rounded-full bg-accent-soft text-accent"><Smartphone size={28} /></div>
            <p className="text-[17px] font-medium">Bitte in der App {challenge.medium ?? 'VR SecureGo plus'} freigeben.</p>
            <p className="mt-1 text-[15px] text-ink-2">{challenge.text}</p>
            <div className="mt-5 size-6 animate-[spin_0.9s_linear_infinite] rounded-full border-2 border-accent border-t-transparent" aria-label="Warte auf Freigabe" />
          </div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); if (value) close(value); }}>
            <p className="mb-3 text-[15px] text-ink-2">{challenge.text}</p>
            <input inputMode="numeric" autoComplete="one-time-code" autoFocus value={value} onChange={e => setValue(e.target.value)}
              className="mb-4 w-full rounded-2xl border border-line bg-surface px-4 py-3.5 text-center text-[22px] tracking-[0.3em] outline-none focus:border-accent" aria-label="TAN" />
            <Button variant="primary" type="submit" className="w-full" disabled={!value}>Bestätigen</Button>
          </form>
        )}
        <Button variant="ghost" type="button" className="mt-1 w-full" onClick={() => close(null)}>Abbrechen</Button>
      </div>
    </Sheet>
  );
}

function PinSheet({ bank, value, setValue, onDone }: { bank: string; value: string; setValue: (v: string) => void; onDone: (v: string | null) => void }) {
  const [mode, setMode] = useState<PinMode>('ask');
  const [vault, setVault] = useState(false);
  const [cred, setCred] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const tried = useRef(false);

  const faceId = async () => {
    setBusy(true); setErr('');
    try {
      const pin = await unlockPin();
      if (pin) onDone(pin); else setVault(false);
    } catch (e) {
      // Abgebrochen oder ohne Fingertipp blockiert → Knopf bleibt, PIN-Eingabe geht immer
      if (!(e instanceof DOMException && e.name === 'NotAllowedError')) setErr(e instanceof Error ? e.message : 'Face ID fehlgeschlagen.');
      setVault(await hasVault());
    } finally { setBusy(false); }
  };

  useEffect(() => {
    void (async () => {
      const [m, v, c] = await Promise.all([getPinMode(), hasVault(), hasCred()]);
      setMode(m); setVault(m === 'faceid' && v); setCred(m === 'faceid' && c);
      if (m === 'faceid' && v && !tried.current) { tried.current = true; void faceId(); }   // klappt oft auch ohne Fingertipp
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!value) return;
    // Face ID eingerichtet, aber noch keine PIN gespeichert → jetzt (der Tipp auf „Anmelden“ erlaubt Face ID)
    if (mode === 'faceid' && cred && !vault) {
      setBusy(true);
      try { await storePin(value); } catch (e) { if (!(e instanceof DOMException && e.name === 'NotAllowedError')) console.warn(e); }
      finally { setBusy(false); }
    }
    onDone(value);
  };

  const hint = mode === 'ask' ? 'Sie wird nur für diesen Abruf verwendet und nirgends gespeichert.'
    : mode === 'session' ? 'Sie bleibt bis zum Schließen der App im Arbeitsspeicher.'
    : vault ? 'Oder mit Face ID entsperren.' : cred ? 'Sie wird mit Face ID verschlüsselt auf diesem iPhone gespeichert.' : 'Sie bleibt bis zum Schließen der App im Arbeitsspeicher.';
  return (
    <Sheet open onClose={() => onDone(null)} title={`Anmeldung ${bank}`}>
      <form onSubmit={e => { e.preventDefault(); void submit(); }} className="pb-2">
        <p className="mb-3 text-[15px] text-ink-2">Gib deine Online-Banking-PIN ein. {hint}</p>
        {vault && (
          <Button variant="primary" type="button" className="mb-3 flex w-full items-center justify-center gap-2" disabled={busy} onClick={() => void faceId()}>
            <ScanFace size={20} /> Mit Face ID anmelden
          </Button>
        )}
        {err && <p className="mb-3 text-[14px] text-neg">{err}</p>}
        <input type="password" autoComplete="current-password" inputMode="numeric" autoFocus={!vault} value={value} onChange={e => setValue(e.target.value)}
          className="mb-4 w-full rounded-2xl border border-line bg-surface px-4 py-3.5 outline-none focus:border-accent" placeholder="PIN" aria-label="PIN" />
        <Button variant={vault ? 'secondary' : 'primary'} type="submit" className="w-full" disabled={!value || busy}>Anmelden</Button>
        <Button variant="ghost" type="button" className="mt-1 w-full" onClick={() => onDone(null)}>Abbrechen</Button>
      </form>
    </Sheet>
  );
}
