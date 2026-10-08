import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { addMonths, monthName, thisMonth } from '../../core/dates';

/** Gewählter Monat steht in der URL (?m=2026-10) – Zurück-Navigation behält ihn. */
export function useSelectedMonth(): [string, (m: string) => void] {
  const [params, setParams] = useSearchParams();
  const m = params.get('m');
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : thisMonth();
  return [month, next => setParams(p => { if (next === thisMonth()) p.delete('m'); else p.set('m', next); return p; }, { replace: true })];
}

export function MonthSwitch({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const isNow = month >= thisMonth();
  return (
    <div className="flex items-center gap-1 text-[15px] font-medium text-ink-2">
      <button aria-label="Vorheriger Monat" onClick={() => onChange(addMonths(month, -1))} className="grid size-9 place-items-center rounded-full active:bg-surface-2"><ChevronLeft size={20} /></button>
      <span className="min-w-[8.5em] text-center text-ink">{monthName(month)}</span>
      <button aria-label="Nächster Monat" disabled={isNow} onClick={() => onChange(addMonths(month, 1))} className="grid size-9 place-items-center rounded-full active:bg-surface-2 disabled:opacity-30"><ChevronRight size={20} /></button>
    </div>
  );
}
