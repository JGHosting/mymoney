/**
 * Duplikaterkennung beim Import.
 *
 * 1. Liefert die Bank eine eindeutige Transaktions-ID → Schlüssel = Konto + ID.
 * 2. Sonst: Hash aus Konto, Buchungsdatum, Betrag, Gegenkonto und normalisiertem Verwendungszweck.
 *    Zwei echte, identische Umsätze am selben Tag (zweimal derselbe Kaffee) bekommen eine laufende
 *    Nummer (#2, #3 …) in der Reihenfolge, in der die Bank sie liefert. Da die Bank bei jedem Abruf
 *    dieselbe Reihenfolge liefert, ergeben überlappende Abrufe dieselben Schlüssel → kein Doppelimport.
 */
import { upper } from './normalize';

export interface DedupeInput {
  accountId: string;
  bankRef?: string;
  bookingDate: string;
  amount: number;
  counterpartyIban?: string;
  purpose: string;
}

/** FNV-1a 53 bit – schnell, stabil, ausreichend gegen zufällige Kollisionen. */
export function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return ((h2 >>> 0) & 0x1fffff).toString(36) + (h1 >>> 0).toString(36);
}

export function baseKey(t: DedupeInput): string {
  if (t.bankRef) return `${t.accountId}|ref|${t.bankRef}`;
  const purpose = upper(t.purpose).replace(/[^A-Z0-9]/g, '');
  return `${t.accountId}|${t.bookingDate}|${t.amount}|${(t.counterpartyIban ?? '').replace(/\s/g, '')}|${hash(purpose)}`;
}

/** Schlüssel für eine ganze Lieferung der Bank (Reihenfolge wie geliefert). */
export function dedupeKeys(list: DedupeInput[]): string[] {
  const seen = new Map<string, number>();
  return list.map(t => {
    const b = baseKey(t);
    const n = (seen.get(b) ?? 0) + 1;
    seen.set(b, n);
    return n === 1 ? b : `${b}#${n}`;
  });
}
