/**
 * Beträge werden überall als ganze Cent (Integer) gespeichert und gerechnet –
 * keine Rundungsfehler durch Gleitkommazahlen. Negativ = Ausgabe, positiv = Eingang.
 */
export type Cents = number;

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 4280.5 € → "4.280,50 €". sign: "+" vor positiven Beträgen. */
export function fmtMoney(c: Cents, opts: { sign?: boolean; round?: boolean; currency?: string } = {}): string {
  const v = c / 100;
  let s: string;
  if (opts.currency && opts.currency !== 'EUR') s = new Intl.NumberFormat('de-DE', { style: 'currency', currency: opts.currency }).format(v);
  else s = (opts.round ? eur0 : eur).format(v);
  s = s.replace('-', '−');
  return opts.sign && c > 0 ? '+' + s : s;
}
/** Zahl ohne Währung, z. B. für große Hero-Anzeigen: [ganz, Nachkomma]. */
export function splitMoney(c: Cents): { sign: string; whole: string; frac: string } {
  const s = num.format(Math.abs(c) / 100);
  const [whole, frac] = s.split(',');
  return { sign: c < 0 ? '−' : '', whole: whole ?? '0', frac: frac ?? '00' };
}
/** Eingabe "12,50" / "12.5" / "1.234,56" → Cent. null bei ungültig. */
export function parseMoney(input: string): Cents | null {
  let s = input.trim().replace(/\s|€/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}
export const fmtPct = (v: number, digits = 0) =>
  new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
