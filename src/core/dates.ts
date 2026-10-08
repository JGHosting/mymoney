/** Datumshilfen. Alle Kalendertage als "YYYY-MM-DD" in lokaler Zeit, Monate als "YYYY-MM". */
const p = (n: number) => String(n).padStart(2, '0');

export const toDay = (d: Date): string => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
export const today = (): string => toDay(new Date());
export const parseDay = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
};
export const addDays = (s: string, n: number): string => {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return toDay(d);
};
export const daysBetween = (a: string, b: string): number =>
  Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);

export const monthOf = (day: string): string => day.slice(0, 7);
export const thisMonth = (): string => monthOf(today());
export const addMonths = (month: string, n: number): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y ?? 1970, (m ?? 1) - 1 + n, 1);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
};
/** Tag + n Monate; am Monatsende wird gekappt (31.01. + 1 Monat → 28./29.02.). */
export const addMonthsToDay = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(y ?? 1970, (m ?? 1) - 1 + n, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d ?? 1, last));
  return toDay(target);
};
export const monthStart = (month: string): string => `${month}-01`;
export const monthEnd = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return toDay(new Date(y ?? 1970, m ?? 1, 0, 12));
};
export const daysInMonth = (month: string): number => Number(monthEnd(month).slice(8));

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const monthName = (month: string, withYear = true): string => {
  const [y, m] = month.split('-').map(Number);
  return MONTHS[(m ?? 1) - 1] + (withYear ? ` ${y}` : '');
};
export const monthShort = (month: string): string => MONTHS_SHORT[Number(month.slice(5, 7)) - 1] ?? '';

/** "Heute", "Gestern" oder "Mo., 12. Oktober". */
export function dayLabel(day: string): string {
  const t = today();
  if (day === t) return 'Heute';
  if (day === addDays(t, -1)) return 'Gestern';
  const d = parseDay(day);
  const sameYear = day.slice(0, 4) === t.slice(0, 4);
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}
export const fmtDate = (day: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) =>
  parseDay(day).toLocaleDateString('de-DE', opts);
export const fmtShortDate = (day: string) => parseDay(day).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) ;

/** "Heute, 14:32" / "Gestern, 09:10" / "03.10., 18:00". */
export function fmtTimestamp(ms: number): string {
  const d = new Date(ms);
  const day = toDay(d);
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const t = today();
  if (day === t) return `Heute, ${time}`;
  if (day === addDays(t, -1)) return `Gestern, ${time}`;
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${time}`;
}
export function fmtAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  return `vor ${days} Tagen`;
}
