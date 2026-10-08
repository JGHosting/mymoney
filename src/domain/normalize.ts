/**
 * Händlernamen aus rohen Bankdaten ableiten.
 * Banken liefern z. B. "REWE MARKT GMBH//AUGSBURG/DE 2026-10-03T18:12 Debitk.12 2028-12"
 * → merchantKey "REWE MARKT" (für Regeln/Erkennung) und Anzeigename "Rewe Markt".
 */

const LEGAL = /\b(GMBH|AG|KG|SE|E V|MBH|CO|UG|OHG|GBR|LTD|INC|S A R L|S C A|B V|EUROPE|DEUTSCHLAND|GERMANY|INTERNATIONAL|DE|EU)\b/g;
const LEGAL_MIXED = /\b(GmbH|AG|KG|SE|e\.?\s?V\.?|mbH|Co\.?|UG|OHG|GbR|Ltd\.?|Inc\.?|S\.a\.r\.l\.?|S\.C\.A\.?|B\.V\.?|SE & Co\. KG)(?=\s|$|,)/gi;

/** Großbuchstaben, Umlaute vereinheitlicht, Sonderzeichen entfernt. */
export function upper(s: string): string {
  return s.toUpperCase()
    .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS')
    .replace(/\s+/g, ' ').trim();
}

/** Stabiler Schlüssel für einen Händler/Gegenpart. */
export function merchantKey(counterparty: string | undefined, purpose: string): string {
  let s = upper(counterparty || purpose.split(/\/\/|\s{2,}/)[0] || purpose);
  s = s.split('//')[0] ?? s;                         // Kartenzahlung: "NAME//ORT/LAND"
  s = s.replace(/\d{4}-\d{2}-\d{2}T?[\d:]*/g, ' ')   // Zeitstempel
       .replace(/\b[A-Z]*\d[A-Z\d]*\b/g, ' ')         // Filialnummern, Referenzen
       .replace(/[.*'"/,:;()#_+&-]+/g, ' ')
       .replace(/\s+/g, ' ')
       .replace(LEGAL, ' ')
       .replace(/\s+/g, ' ').trim();
  return s.split(' ').slice(0, 3).join(' ') || 'UNBEKANNT';
}

/** "REWE MARKT" → "Rewe Markt"; kurze Abkürzungen (≤3 Zeichen) bleiben groß. */
export function prettyName(key: string): string {
  return key.split(' ').map(w => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase())).join(' ');
}

/**
 * Anzeigename aus dem Original-Gegenpart (Umlaute und Schreibweise bleiben erhalten):
 * "REWE Markt GmbH//Augsburg" → "REWE Markt", "DB VERTRIEB GMBH" → "Db Vertrieb".
 */
export function displayName(counterparty: string | undefined, key: string): string {
  let s = (counterparty ?? '').split('//')[0] ?? '';
  s = s.replace(LEGAL_MIXED, ' ').replace(/\b\S*\d\S*\b/g, ' ').replace(/[,;]+/g, ' ').replace(/[-.&\s]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return prettyName(key);
  const words = s.split(' ').slice(0, 4);
  const allCaps = s === s.toUpperCase();
  const title = (w: string) => w.split('-').map(p => (p.length > 3 ? p[0] + p.slice(1).toLowerCase() : p)).join('-');
  return words.map(w => (allCaps ? title(w) : w)).join(' ');
}
