/**
 * Realistische Demo-Umsätze. Deterministisch: Für jeden Kalendertag entstehen immer dieselben
 * Umsätze – überlappende Abrufe liefern also identische Daten (wie eine echte Bank).
 */
import type { BankTransactionData } from '../types';
import { addDays, daysBetween, parseDay } from '../../core/dates';
import { hash } from '../../domain/dedupe';

export const MOCK_GIRO = 'DE02720691550000123456';
export const MOCK_SAVINGS = 'DE02720691550000654321';
const ORIGIN = '2025-01-01';
const START_BALANCE_GIRO = 320000;
const START_BALANCE_SAVINGS = 420000;

function rng(seed: string) {
  let a = parseInt(hash(seed).slice(-7), 36) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
const between = (r: () => number, min: number, max: number) => Math.round((min + r() * (max - min)) * 100);

/** Werktag: Wochenende → nächster Montag (wie Lastschriften). */
function isBookingDay(day: string, dom: number): boolean {
  const d = parseDay(day);
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  // gewünschter Tag oder (falls dieser aufs Wochenende fiel) der folgende Montag
  const target = new Date(d.getFullYear(), d.getMonth(), Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()), 12);
  while (target.getDay() === 0 || target.getDay() === 6) target.setDate(target.getDate() + 1);
  return target.getDate() === d.getDate() && target.getMonth() === d.getMonth();
}
/** Gehalt: letzter Werktag vor dem 28. (bzw. der 28. selbst). */
function isSalaryDay(day: string): boolean {
  const d = parseDay(day);
  const t = new Date(d.getFullYear(), d.getMonth(), 28, 12);
  while (t.getDay() === 0 || t.getDay() === 6) t.setDate(t.getDate() - 1);
  return t.getDate() === d.getDate();
}

const CARD = (name: string, city: string, day: string, r: () => number) =>
  `${name}//${city}/DE ${day}T${String(8 + Math.floor(r() * 12)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}:00 KFN 1 VJ 2812 Kartenzahlung`;

interface Fixed { dom: number; months?: number[]; name: string; iban: string; amount: number | ((day: string) => number); purpose: (day: string) => string; text: string; creditor?: string; since?: string }

const mm = (day: string) => `${day.slice(5, 7)}/${day.slice(0, 4)}`;
const FIXED: Fixed[] = [
  { dom: 1, name: 'Hausverwaltung Lechufer GmbH', iban: 'DE89720500000000777001', amount: -110000, purpose: d => `Miete ${mm(d)} Wohnung 2.OG links`, text: 'Dauerauftrag' },
  { dom: 1, name: 'Allianz Versicherungs-AG', iban: 'DE12700800000945612300', amount: -7200, purpose: d => `Hausrat/Haftpflicht Vertr. 4711-0815 Beitrag ${mm(d)}`, text: 'Lastschrift', creditor: 'DE69ZZZ00000013540' },
  { dom: 1, name: 'RSG Group GmbH', iban: 'DE44770500000000111222', amount: -2490, purpose: () => 'McFIT Mitgliedsbeitrag Augsburg', text: 'Lastschrift', creditor: 'DE19ZZZ00000256789' },
  { dom: 1, name: 'swa Augsburger Verkehrs-GmbH', iban: 'DE38720500000000040040', amount: d => (d >= '2026-01-01' ? -6300 : -5800), purpose: d => `Deutschlandticket Abo ${mm(d)}`, text: 'Lastschrift' },
  { dom: 2, name: 'VR Bank Sparkonto', iban: MOCK_SAVINGS, amount: -30000, purpose: () => 'Umbuchung Sparrate', text: 'Dauerauftrag' },
  { dom: 3, name: 'Trade Republic Bank GmbH', iban: 'DE47100123450000998877', amount: -25000, purpose: () => 'Sparplan ETF Einzahlung', text: 'Dauerauftrag' },
  { dom: 3, name: 'Apple Services', iban: 'IE29AIBK93115212345678', amount: -299, purpose: () => 'APPLE.COM/BILL iCloud+ 200GB', text: 'Lastschrift' },
  { dom: 5, name: 'Vodafone GmbH', iban: 'DE68300700100800100100', amount: -3999, purpose: d => `Kd-Nr 118822334 Rechnung ${mm(d)} Internet`, text: 'Lastschrift' },
  { dom: 9, name: 'Amazon EU S.a.r.l.', iban: 'DE87300308800013120025', amount: -899, purpose: () => 'Amazon Prime Mitgliedschaft', text: 'Lastschrift' },
  { dom: 10, name: 'congstar GmbH', iban: 'DE23300606010006060606', amount: -1900, purpose: d => `Mobilfunk Rechnung ${mm(d)}`, text: 'Lastschrift' },
  { dom: 15, name: 'Stadtwerke Augsburg Energie GmbH', iban: 'DE51720500000000015015', amount: -8500, purpose: d => `Abschlag Strom ${mm(d)} Vertragskonto 300123`, text: 'Lastschrift' },
  { dom: 15, name: 'Spotify AB', iban: 'SE3550000000054910000003', amount: -1199, purpose: () => 'Spotify Premium P1A2B3C4', text: 'Lastschrift' },
  { dom: 15, months: [2, 5, 8, 11], name: 'Rundfunk ARD ZDF DRadio', iban: 'DE68370500000033000000', amount: -5508, purpose: () => 'Rundfunkbeitrag Beitragsnr. 123 456 789', text: 'Lastschrift' },
  { dom: 22, name: 'Netflix International B.V.', iban: 'NL52RABO0310930000', amount: -1399, purpose: () => 'Netflix Monatsabo', text: 'Lastschrift' },
  { dom: 2, months: [1], name: 'HUK-COBURG', iban: 'DE51783500000000123123', amount: -42000, purpose: d => `Kfz-Versicherung A-XY 123 Jahresbeitrag ${d.slice(0, 4)}`, text: 'Lastschrift' },
  { dom: 20, months: [4], name: 'Bundeskasse Trier', iban: 'DE81590000000059001020', amount: -11400, purpose: () => 'Kfz-Steuer A-XY 123', text: 'Lastschrift' }
];

const GROCERY = [['REWE Markt GmbH', 'Augsburg'], ['EDEKA Center', 'Augsburg'], ['ALDI SUED', 'Augsburg'], ['Lidl Dienstleistung', 'Augsburg'], ['V-Markt', 'Augsburg']] as const;
const FOOD = [['Bäckerei Wolf', 'Augsburg', 2.8, 9], ['Restaurant Bauerntanz', 'Augsburg', 18, 52], ['Pizzeria Da Pino', 'Augsburg', 14, 38], ['Cafe Dichtl', 'Augsburg', 6, 19],
  ['McDonalds', 'Augsburg', 7, 16], ['Restaurant Ratskeller', 'Augsburg', 22, 64], ['Starbucks', 'Muenchen', 5, 12]] as const;

/** Variable Umsätze eines Tages. */
function variable(day: string): BankTransactionData[] {
  const r = rng('var:' + day);
  const d = parseDay(day);
  const wd = d.getDay();
  const month = d.getMonth() + 1;
  const out: BankTransactionData[] = [];
  const card = (name: string, city: string, amount: number, cp = name): BankTransactionData =>
    ({ bookingDate: day, valueDate: day, amount: -amount, currency: 'EUR', counterpartyName: cp, purpose: CARD(name, city, day, r), bookingText: 'Kartenzahlung' });

  if (wd !== 0) {
    if (r() < (wd === 6 ? 0.75 : 0.32)) { const [n, c] = pick(r, [...GROCERY]); out.push(card(n, c, between(r, 6, wd === 6 ? 92 : 48))); }
    if (r() < 0.22) { const f = pick(r, [...FOOD]); out.push(card(f[0], f[1], between(r, f[2], f[3]))); }
    if (r() < 0.07) out.push(card('dm-drogerie markt', 'Augsburg', between(r, 6, 34)));
    if (r() < 0.05) out.push(card(pick(r, ['Shell Deutschland', 'Aral Station', 'JET Tankstelle']), 'Augsburg', between(r, 48, 82)));
    if (r() < 0.025) out.push(card('Apotheke am Koenigsplatz', 'Augsburg', between(r, 4, 28)));
  }
  if (r() < 0.07) {
    out.push({ bookingDate: day, valueDate: day, amount: -between(r, 9, month === 12 ? 140 : 75), currency: 'EUR', counterpartyName: 'AMAZON PAYMENTS EUROPE S.C.A.',
      purpose: `AMZN Mktp DE ${String(Math.floor(r() * 9e6)).padStart(7, '3')}-${Math.floor(r() * 9e6)} Amazon.de`, bookingText: 'Lastschrift' });
  }
  if (r() < 0.045) out.push({ bookingDate: day, amount: -between(r, 16, 38), currency: 'EUR', counterpartyName: 'Lieferando.de', purpose: `Lieferando Bestellung ${Math.floor(r() * 1e6)}`, bookingText: 'Lastschrift' });
  if (r() < 0.02) out.push(card('CinemaxX Augsburg', 'Augsburg', between(r, 11, 26)));
  if (r() < 0.02) out.push({ bookingDate: day, amount: -between(r, 19, 79), currency: 'EUR', counterpartyName: 'DB Vertrieb GmbH', purpose: `DB Fernverkehr Fahrkarte ${Math.floor(r() * 1e8)}`, bookingText: 'Lastschrift' });
  if (r() < (month === 12 || month === 3 ? 0.03 : 0.012)) out.push({ bookingDate: day, amount: -between(r, 25, 120), currency: 'EUR', counterpartyName: 'Zalando SE', purpose: `Zalando Bestellung ${Math.floor(r() * 1e9)}`, bookingText: 'Lastschrift' });
  if (r() < 0.012) out.push(card('Sport Schuster', 'Muenchen', between(r, 25, 160)));
  if ((month <= 3 || month === 12) && wd === 6 && r() < 0.3) out.push(card('Bergbahnen Oberstdorf', 'Oberstdorf', between(r, 42, 58)));
  if ((month >= 6 && month <= 9) && wd === 6 && r() < 0.12) out.push(card('Alpenverein Huette Waltenberger', 'Oberstdorf', between(r, 18, 46)));
  if (r() < 0.008) out.push({ bookingDate: day, amount: -between(r, 9, 59), currency: 'EUR', counterpartyName: 'Valve Corporation', purpose: 'STEAM PURCHASE STEAMPOWERED.COM', bookingText: 'Lastschrift' });
  if (r() < 0.006) out.push(card('IKEA Deutschland', 'Augsburg', between(r, 20, 180)));
  if (r() < 0.035) out.push({ bookingDate: day, amount: -(pick(r, [50, 50, 100, 60]) * 100), currency: 'EUR', counterpartyName: 'GA NR00001234 BLZ72069155', purpose: `Bargeldauszahlung GA NR00001234 BLZ72069155 ${day}`, bookingText: 'Auszahlung Geldautomat' });
  if (r() < 0.006) out.push({ bookingDate: day, amount: between(r, 15, 60), currency: 'EUR', counterpartyName: 'AMAZON PAYMENTS EUROPE S.C.A.', purpose: 'AMZN Mktp DE Rueckerstattung', bookingText: 'Gutschrift' });
  if (month === 8 && d.getDate() === 12) out.push({ bookingDate: day, amount: -48600, currency: 'EUR', counterpartyName: 'Booking.com B.V.', purpose: 'Booking.com Hotel Lago di Garda 3 Naechte', bookingText: 'Lastschrift' });
  return out;
}

/** Alle Girokonto-Umsätze eines Tages (feste Zahlungen zuerst, dann Kartenzahlungen). */
export function giroDay(day: string): BankTransactionData[] {
  const month = Number(day.slice(5, 7));
  const out: BankTransactionData[] = [];
  if (isSalaryDay(day)) {
    out.push({ bookingDate: day, valueDate: day, amount: 315000, currency: 'EUR', counterpartyName: 'Muster Engineering GmbH', counterpartyIban: 'DE91720400460123456700',
      purpose: `GEHALT ${mm(day)} PERS.NR. 10427`, bookingText: 'Gutschrift' });
  }
  for (const f of FIXED) {
    if (f.months && !f.months.includes(month)) continue;
    if (!isBookingDay(day, f.dom)) continue;
    out.push({ bookingDate: day, valueDate: day, amount: typeof f.amount === 'function' ? f.amount(day) : f.amount, currency: 'EUR',
      counterpartyName: f.name, counterpartyIban: f.iban, purpose: f.purpose(day), bookingText: f.text, ...(f.creditor ? { creditorId: f.creditor, mandateRef: 'MR-' + hash(f.name).slice(0, 8).toUpperCase() } : {}) });
  }
  return [...out, ...variable(day)];
}

export function savingsDay(day: string): BankTransactionData[] {
  const out: BankTransactionData[] = [];
  if (isBookingDay(day, 2)) out.push({ bookingDate: day, valueDate: day, amount: 30000, currency: 'EUR', counterpartyName: 'VR Bank Girokonto', counterpartyIban: MOCK_GIRO, purpose: 'Umbuchung Sparrate', bookingText: 'Dauerauftrag' });
  const d = parseDay(day);
  if (d.getMonth() === 11 && d.getDate() === 31) out.push({ bookingDate: day, amount: 3150, currency: 'EUR', counterpartyName: 'VR Bank', purpose: 'Zinsgutschrift', bookingText: 'Abschluss' });
  return out;
}

export function range(externalId: string, from: string, to: string): BankTransactionData[] {
  const gen = externalId === MOCK_SAVINGS ? savingsDay : giroDay;
  const out: BankTransactionData[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(...gen(day));
  return out;
}

/** Saldo am Ende von `day` – aus festem Startpunkt berechnet, damit er zu den Umsätzen passt. */
export function balanceAt(externalId: string, day: string): number {
  const start = externalId === MOCK_SAVINGS ? START_BALANCE_SAVINGS : START_BALANCE_GIRO;
  if (daysBetween(ORIGIN, day) < 0) return start;
  return range(externalId, ORIGIN, day).reduce((s, t) => s + t.amount, start);
}
