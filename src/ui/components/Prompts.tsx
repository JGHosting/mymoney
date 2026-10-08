/** PIN- und TAN-Abfrage während eines Syncs. Die PIN lebt nur in diesem Formular und wird nie gespeichert. */
import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { useApp } from '../../store/app';
import { Sheet } from './Sheet';
import { Button } from './ui';

export function Prompts() {
  const prompt = useApp(s => s.prompt);
  const [value, setValue] = useState('');
  if (!prompt) return null;
  const close = (v: string | null) => { prompt.resolve(v); setValue(''); useApp.setState({ prompt: null }); };

  if (prompt.kind === 'pin') {
    return (
      <Sheet open onClose={() => close(null)} title={`Anmeldung ${prompt.bank}`}>
        <form onSubmit={e => { e.preventDefault(); if (value) close(value); }} className="pb-2">
          <p className="mb-3 text-[15px] text-ink-2">Gib deine Online-Banking-PIN ein. Sie wird nur für diesen Abruf verwendet und nirgends gespeichert.</p>
          <input type="password" autoComplete="current-password" inputMode="text" autoFocus value={value} onChange={e => setValue(e.target.value)}
            className="mb-4 w-full rounded-2xl border border-line bg-surface px-4 py-3.5 outline-none focus:border-accent" placeholder="PIN" aria-label="PIN" />
          <Button variant="primary" type="submit" className="w-full" disabled={!value}>Anmelden</Button>
          <Button variant="ghost" type="button" className="mt-1 w-full" onClick={() => close(null)}>Abbrechen</Button>
        </form>
      </Sheet>
    );
  }
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
