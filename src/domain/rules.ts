/**
 * Eingebaute Kategorisierungsregeln: Teiltext (Großbuchstaben) → Kategorie + Anzeigename.
 * Reihenfolge = Priorität (erste passende gewinnt). Eigene Regeln (Datenbank) kommen immer vor den eingebauten.
 * Eingebaute Regeln liegen nur im Code – so kommen Verbesserungen mit jedem App-Update automatisch an.
 */
import type { Rule } from '../core/db';

type R = [pattern: string, categoryId: string, merchant?: string, field?: Rule['field']];

const DEFS: R[] = [
  // Lebensmittel
  ['REWE', 'lebensmittel.supermarkt', 'REWE'], ['EDEKA', 'lebensmittel.supermarkt', 'EDEKA'], ['ALDI', 'lebensmittel.supermarkt', 'ALDI SÜD'],
  ['LIDL', 'lebensmittel.supermarkt', 'Lidl'], ['NETTO', 'lebensmittel.supermarkt', 'Netto'], ['PENNY', 'lebensmittel.supermarkt', 'Penny'],
  ['KAUFLAND', 'lebensmittel.supermarkt', 'Kaufland'], ['TEGUT', 'lebensmittel.supermarkt', 'tegut'], ['V-MARKT', 'lebensmittel.supermarkt', 'V-Markt'],
  ['BAECKEREI', 'lebensmittel.restaurants', 'Bäckerei'], ['BÄCKEREI', 'lebensmittel.restaurants', 'Bäckerei'],
  ['LIEFERANDO', 'lebensmittel.lieferdienste', 'Lieferando'], ['WOLT', 'lebensmittel.lieferdienste', 'Wolt'], ['UBER EATS', 'lebensmittel.lieferdienste', 'Uber Eats'],
  ['MCDONALDS', 'lebensmittel.restaurants', 'McDonald’s'], ['BURGER KING', 'lebensmittel.restaurants', 'Burger King'], ['STARBUCKS', 'lebensmittel.restaurants', 'Starbucks'],
  ['RESTAURANT', 'lebensmittel.restaurants'], ['PIZZERIA', 'lebensmittel.restaurants'], ['CAFE', 'lebensmittel.restaurants'], ['GASTSTAETTE', 'lebensmittel.restaurants'],
  // Streaming & Digitales
  ['NETFLIX', 'freizeit.streaming', 'Netflix'], ['SPOTIFY', 'freizeit.streaming', 'Spotify'], ['DISNEY PLUS', 'freizeit.streaming', 'Disney+'],
  ['DISNEYPLUS', 'freizeit.streaming', 'Disney+'], ['DAZN', 'freizeit.streaming', 'DAZN'], ['YOUTUBE', 'freizeit.streaming', 'YouTube Premium'],
  ['AMAZON PRIME', 'freizeit.streaming', 'Amazon Prime'], ['PRIME VIDEO', 'freizeit.streaming', 'Amazon Prime'],
  ['APPLE.COM/BILL', 'freizeit.digital', 'Apple'], ['ICLOUD', 'freizeit.digital', 'iCloud+'], ['GOOGLE ONE', 'freizeit.digital', 'Google One'],
  ['MICROSOFT', 'freizeit.digital', 'Microsoft'], ['ADOBE', 'freizeit.digital', 'Adobe'], ['CHATGPT', 'freizeit.digital', 'OpenAI'], ['ANTHROPIC', 'freizeit.digital', 'Claude'],
  ['STEAM', 'freizeit.gaming', 'Steam'], ['PLAYSTATION', 'freizeit.gaming', 'PlayStation'], ['NINTENDO', 'freizeit.gaming', 'Nintendo'],
  // Freizeit
  ['CINEMAXX', 'freizeit.kino', 'CinemaxX'], ['CINEPLEX', 'freizeit.kino', 'Cineplex'], ['KINO', 'freizeit.kino'], ['EVENTIM', 'freizeit.kino', 'Eventim'],
  ['MCFIT', 'freizeit.sport', 'McFIT'], ['FITNESS', 'freizeit.sport'], ['URBAN SPORTS', 'freizeit.sport', 'Urban Sports Club'], ['BOULDER', 'freizeit.sport'],
  ['DAV', 'freizeit.sport', 'Alpenverein'], ['ALPENVEREIN', 'freizeit.sport', 'Alpenverein'], ['BERGBAHN', 'freizeit.sport'], ['SKILIFT', 'freizeit.sport'],
  ['SPORT SCHUSTER', 'freizeit.sport', 'Sport Schuster'], ['GLOBETROTTER', 'freizeit.sport', 'Globetrotter'], ['BERGZEIT', 'freizeit.sport', 'Bergzeit'],
  ['DECATHLON', 'freizeit.sport', 'Decathlon'], ['PRUSA', 'freizeit.hobbys', 'Prusa'], ['CONRAD', 'freizeit.hobbys', 'Conrad'],
  // Mobilität
  ['SHELL', 'mobilitaet.tanken', 'Shell'], ['ARAL', 'mobilitaet.tanken', 'Aral'], ['ESSO', 'mobilitaet.tanken', 'Esso'], ['JET TANKSTELLE', 'mobilitaet.tanken', 'JET'],
  ['TOTALENERGIES', 'mobilitaet.tanken', 'TotalEnergies'], ['AGIP', 'mobilitaet.tanken', 'Agip'], ['TANKSTELLE', 'mobilitaet.tanken'],
  ['IONITY', 'mobilitaet.tanken', 'IONITY'], ['ENBW MOBILITY', 'mobilitaet.tanken', 'EnBW mobility+'],
  ['DB VERTRIEB', 'mobilitaet.oepnv', 'Deutsche Bahn'], ['DEUTSCHE BAHN', 'mobilitaet.oepnv', 'Deutsche Bahn'], ['DB FERNVERKEHR', 'mobilitaet.oepnv', 'Deutsche Bahn'],
  ['MVV', 'mobilitaet.oepnv', 'MVV'], ['MVG', 'mobilitaet.oepnv', 'MVG'], ['SWA', 'mobilitaet.oepnv', 'swa Augsburg', 'counterparty'], ['AVV', 'mobilitaet.oepnv', 'AVV'],
  ['FLIXBUS', 'mobilitaet.oepnv', 'FlixBus'], ['DEUTSCHLANDTICKET', 'mobilitaet.oepnv', 'Deutschlandticket'],
  ['UBER', 'mobilitaet.taxi', 'Uber'], ['FREENOW', 'mobilitaet.taxi', 'FREENOW'], ['SHARE NOW', 'mobilitaet.taxi', 'SHARE NOW'], ['TIER', 'mobilitaet.taxi', 'TIER', 'counterparty'],
  ['ATU', 'mobilitaet.auto', 'A.T.U', 'counterparty'], ['KFZ-STEUER', 'mobilitaet.auto', 'Kfz-Steuer'], ['BUNDESKASSE', 'mobilitaet.auto', 'Bundeskasse'],
  ['PARKHAUS', 'mobilitaet.auto'], ['PARKEN', 'mobilitaet.auto'], ['WASCHSTRASSE', 'mobilitaet.auto'],
  // Wohnen
  ['MIETE', 'wohnen.miete', undefined, 'purpose'], ['STADTWERKE', 'wohnen.strom', 'Stadtwerke'], ['E.ON', 'wohnen.strom', 'E.ON'], ['EON', 'wohnen.strom', 'E.ON'],
  ['LECHWERKE', 'wohnen.strom', 'LEW'], ['VATTENFALL', 'wohnen.strom', 'Vattenfall'], ['TIBBER', 'wohnen.strom', 'Tibber'], ['STROM', 'wohnen.strom', undefined, 'purpose'],
  ['RUNDFUNK', 'wohnen.nebenkosten', 'Rundfunkbeitrag'], ['NEBENKOSTEN', 'wohnen.nebenkosten', undefined, 'purpose'],
  ['VODAFONE', 'wohnen.internet', 'Vodafone'], ['TELEKOM', 'wohnen.internet', 'Telekom'], ['O2', 'wohnen.internet', 'O2'], ['TELEFONICA', 'wohnen.internet', 'O2'],
  ['1&1', 'wohnen.internet', '1&1'], ['CONGSTAR', 'wohnen.internet', 'congstar'], ['M-NET', 'wohnen.internet', 'M-net'],
  // Shopping
  ['AMAZON', 'shopping.online', 'Amazon'], ['AMZN', 'shopping.online', 'Amazon'], ['ZALANDO', 'shopping.kleidung', 'Zalando'], ['H&M', 'shopping.kleidung', 'H&M'],
  ['ZARA', 'shopping.kleidung', 'Zara'], ['UNIQLO', 'shopping.kleidung', 'Uniqlo'], ['ABOUT YOU', 'shopping.kleidung', 'About You'],
  ['MEDIAMARKT', 'shopping.elektronik', 'MediaMarkt'], ['SATURN', 'shopping.elektronik', 'Saturn'], ['APPLE STORE', 'shopping.elektronik', 'Apple Store'],
  ['IKEA', 'shopping.haushalt', 'IKEA'], ['OBI', 'shopping.haushalt', 'OBI', 'counterparty'], ['BAUHAUS', 'shopping.haushalt', 'Bauhaus'], ['HORNBACH', 'shopping.haushalt', 'Hornbach'],
  ['EBAY', 'shopping.online', 'eBay'], ['OTTO', 'shopping.online', 'OTTO', 'counterparty'], ['KLEINANZEIGEN', 'shopping.online', 'Kleinanzeigen'],
  // Gesundheit
  ['APOTHEKE', 'gesundheit.apotheke', 'Apotheke'], ['DM-DROGERIE', 'gesundheit.drogerie', 'dm'], ['DM DROGERIE', 'gesundheit.drogerie', 'dm'],
  ['ROSSMANN', 'gesundheit.drogerie', 'Rossmann'], ['MUELLER', 'gesundheit.drogerie', 'Müller', 'counterparty'], ['PRAXIS', 'gesundheit.arzt'], ['ZAHNARZT', 'gesundheit.arzt'],
  // Versicherungen
  ['VERSICHERUNG', 'versicherungen'], ['HUK', 'versicherungen', 'HUK-COBURG'], ['ALLIANZ', 'versicherungen', 'Allianz'], ['ERGO', 'versicherungen', 'ERGO', 'counterparty'],
  ['AXA', 'versicherungen', 'AXA', 'counterparty'], ['DEVK', 'versicherungen', 'DEVK'], ['CHECK24', 'versicherungen', 'CHECK24'], ['TECHNIKER', 'versicherungen', 'Techniker Krankenkasse'],
  ['VERSICHERUNGSKAMMER', 'versicherungen', 'Versicherungskammer Bayern'],
  // Reisen
  ['BOOKING.COM', 'reisen', 'Booking.com'], ['AIRBNB', 'reisen', 'Airbnb'], ['LUFTHANSA', 'reisen', 'Lufthansa'], ['RYANAIR', 'reisen', 'Ryanair'],
  ['EUROWINGS', 'reisen', 'Eurowings'], ['HOTEL', 'reisen'], ['HUETTE', 'reisen'], ['HÜTTE', 'reisen'],
  // Bargeld
  ['GELDAUTOMAT', 'bargeld', 'Geldautomat'], ['BARGELDAUSZAHLUNG', 'bargeld', 'Bargeld'], ['GA NR', 'bargeld', 'Geldautomat'],
  // Einkommen
  ['GEHALT', 'einkommen.gehalt', undefined, 'purpose'], ['LOHN', 'einkommen.gehalt', undefined, 'purpose'], ['BEZUEGE', 'einkommen.gehalt', undefined, 'purpose'],
  ['ERSTATTUNG', 'einkommen.erstattungen', undefined, 'purpose'], ['RUECKERSTATTUNG', 'einkommen.erstattungen', undefined, 'purpose'], ['FINANZAMT', 'einkommen.erstattungen', 'Finanzamt'],
  // Sparen / Umbuchungen
  ['TRADE REPUBLIC', 'sparen', 'Trade Republic'], ['SCALABLE', 'sparen', 'Scalable Capital'], ['SPARPLAN', 'sparen', undefined, 'purpose'],
  ['UMBUCHUNG', 'sparen', 'Umbuchung', 'purpose'], ['UEBERTRAG', 'sparen', 'Übertrag', 'purpose'], ['PAYPAL', 'shopping.online', 'PayPal']
];

export const BUILTIN_RULES: Rule[] = DEFS.map(([pattern, categoryId, merchant, field]) => ({
  id: `builtin:${pattern}:${categoryId}`,
  pattern, field: field ?? 'any', categoryId, ...(merchant ? { merchant } : {}),
  builtin: true, createdAt: 0, updatedAt: 0
}));
