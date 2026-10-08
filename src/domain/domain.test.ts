import { describe, expect, it } from 'vitest';
import { categorizeTransaction } from './categorize';
import { dedupeKeys } from './dedupe';
import { displayName, merchantKey } from './normalize';
import { change, monthSummary, savingsRate, toEntries, averageMonth, cumulativeByDay } from './stats';
import { budgetLevel, budgetStatus } from './budgets';
import { detectRecurring, monthlyAmount, nextDue } from './recurring';
import { pendingInMonth, freeToSpend } from './forecast';
import { BUILTIN_CATEGORIES } from './categories';
import type { Recurring, Transaction } from '../core/db';
import { addMonthsToDay } from '../core/dates';
import { parseMoney, fmtMoney } from '../core/money';

const cats = new Map(BUILTIN_CATEGORIES.map(c => [c.id, c]));
let n = 0;
function tx(p: Partial<Transaction> & { bookingDate: string; amount: number }): Transaction {
  n++;
  const categoryId = p.categoryId ?? (p.amount < 0 ? 'sonstiges' : 'einkommen.sonstiges');
  return {
    id: 't' + n, accountId: 'a', dedupeKey: 'k' + n, currency: 'EUR', purpose: '', merchantKey: p.merchantKey ?? 'X', merchant: p.merchant ?? 'X',
    categorySource: 'rule', kind: cats.get(categoryId)?.kind ?? 'expense', createdAt: 0, updatedAt: 0, categoryId, ...p
  };
}

describe('Kategorisierung', () => {
  it('erkennt bekannte Händler', () => {
    expect(categorizeTransaction({ amount: -1199, counterpartyName: 'Spotify AB', purpose: 'Spotify Premium' }).categoryId).toBe('freizeit.streaming');
    expect(categorizeTransaction({ amount: -6234, counterpartyName: 'REWE Markt GmbH', purpose: 'REWE Markt GmbH//Augsburg/DE' })).toMatchObject({ categoryId: 'lebensmittel.supermarkt', merchant: 'REWE' });
    expect(categorizeTransaction({ amount: -5500, counterpartyName: 'Shell Deutschland', purpose: '' }).categoryId).toBe('mobilitaet.tanken');
    expect(categorizeTransaction({ amount: -1399, counterpartyName: 'Netflix International B.V.', purpose: '' }).categoryId).toBe('freizeit.streaming');
  });
  it('Amazon Prime vor Amazon', () => {
    expect(categorizeTransaction({ amount: -899, counterpartyName: 'Amazon EU', purpose: 'Amazon Prime Mitgliedschaft' }).categoryId).toBe('freizeit.streaming');
    expect(categorizeTransaction({ amount: -2999, counterpartyName: 'AMAZON PAYMENTS', purpose: 'AMZN Mktp DE' }).categoryId).toBe('shopping.online');
  });
  it('kurze Muster nur als ganzes Wort', () => {
    expect(categorizeTransaction({ amount: -5000, counterpartyName: 'TIERARZT Dr. Huber', purpose: '' }).categoryId).toBe('sonstiges');
    expect(categorizeTransaction({ amount: -300, counterpartyName: 'TIER Mobility', purpose: '' }).categoryId).toBe('mobilitaet.taxi');
  });
  it('Gehalt nur als Eingang, Händler-Regeln nicht für Eingänge', () => {
    expect(categorizeTransaction({ amount: 325000, counterpartyName: 'Muster GmbH', purpose: 'GEHALT 10/2026' }).categoryId).toBe('einkommen.gehalt');
    expect(categorizeTransaction({ amount: -100, counterpartyName: 'X', purpose: 'Gehalt Vorschuss Rückzahlung' }).categoryId).toBe('sonstiges');
    expect(categorizeTransaction({ amount: 2000, counterpartyName: 'REWE', purpose: 'Pfand' }).categoryId).toBe('einkommen.sonstiges');
    expect(categorizeTransaction({ amount: 2000, counterpartyName: 'AMAZON', purpose: 'Rueckerstattung' }).categoryId).toBe('shopping.online');
  });
  it('eigene Regeln gehen vor', () => {
    const rule = { id: 'r', pattern: 'REWE MARKT', field: 'merchantKey' as const, categoryId: 'freizeit.hobbys', createdAt: 1, updatedAt: 1 };
    expect(categorizeTransaction({ amount: -100, counterpartyName: 'REWE Markt GmbH', purpose: '', merchantKey: 'REWE MARKT' }, [rule]).categoryId).toBe('freizeit.hobbys');
  });
  it('ohne Treffer: Sonstiges', () => {
    expect(categorizeTransaction({ amount: -100, counterpartyName: 'Unbekannt', purpose: '' }).categoryId).toBe('sonstiges');
  });
});

describe('Händlernamen', () => {
  it('normalisiert', () => {
    expect(merchantKey('REWE Markt GmbH', '')).toBe('REWE MARKT');
    expect(merchantKey(undefined, 'Amazon EU S.a.r.l. Prime')).toBe('AMAZON PRIME');
    expect(merchantKey('Amazon EU S.a.r.l.', 'x')).toBe('AMAZON');
    expect(merchantKey('Bäckerei Wolf', '')).toBe('BAECKEREI WOLF');
  });
  it('Anzeigename behält Umlaute', () => {
    expect(displayName('Bäckerei Wolf', 'BAECKEREI WOLF')).toBe('Bäckerei Wolf');
    expect(displayName('DB VERTRIEB GMBH', 'DB VERTRIEB')).toBe('DB Vertrieb');
    expect(displayName('Hausverwaltung Lechufer GmbH', 'X')).toBe('Hausverwaltung Lechufer');
  });
});

describe('Duplikaterkennung', () => {
  const base = { accountId: 'a', bookingDate: '2026-10-01', amount: -320, purpose: 'Bäckerei' };
  it('gleiche Daten → gleicher Schlüssel, egal wann abgerufen', () => {
    expect(dedupeKeys([base])).toEqual(dedupeKeys([{ ...base }]));
  });
  it('zwei identische Umsätze am selben Tag bleiben beide erhalten', () => {
    const k = dedupeKeys([base, { ...base }]);
    expect(new Set(k).size).toBe(2);
    expect(k[1]).toMatch(/#2$/);
  });
  it('Bank-ID hat Vorrang', () => {
    expect(dedupeKeys([{ ...base, bankRef: 'X1' }])[0]).toBe('a|ref|X1');
  });
  it('unterschiedlicher Betrag → anderer Schlüssel', () => {
    expect(dedupeKeys([base])[0]).not.toBe(dedupeKeys([{ ...base, amount: -330 }])[0]);
  });
});

describe('Monatsberechnung & Sparquote', () => {
  const txs = [
    tx({ bookingDate: '2026-10-01', amount: 325000, categoryId: 'einkommen.gehalt' }),
    tx({ bookingDate: '2026-10-02', amount: -110000, categoryId: 'wohnen.miete' }),
    tx({ bookingDate: '2026-10-03', amount: -6200, categoryId: 'lebensmittel.supermarkt' }),
    tx({ bookingDate: '2026-10-04', amount: 1000, categoryId: 'shopping.online' }),             // Erstattung
    tx({ bookingDate: '2026-10-05', amount: -30000, categoryId: 'sparen' }),                   // Umbuchung
    tx({ bookingDate: '2026-10-06', amount: -99999, categoryId: 'sonstiges', ignored: true }), // ignoriert
    tx({ bookingDate: '2026-10-07', amount: -10000, categoryId: 'sonstiges', splits: [{ categoryId: 'freizeit.kino', amount: -4000 }, { categoryId: 'lebensmittel.restaurants', amount: -6000 }] }),
    tx({ bookingDate: '2026-09-30', amount: -5000, categoryId: 'lebensmittel.supermarkt' })
  ];
  const e = toEntries(txs, cats);
  const s = monthSummary(e, '2026-10');
  it('summiert Einnahmen und Ausgaben ohne Umbuchungen und Ignoriertes', () => {
    expect(s.income).toBe(325000);
    expect(s.expense).toBe(110000 + 6200 - 1000 + 10000);
    expect(s.net).toBe(325000 - 125200);
  });
  it('Aufteilung verteilt auf Kategorien', () => {
    expect(s.byRoot.get('freizeit')).toBe(4000);
    expect(s.byRoot.get('lebensmittel')).toBe(6200 + 6000);
    expect(s.byRoot.get('sparen')).toBeUndefined();
  });
  it('Sparquote', () => {
    expect(savingsRate(325000, 184200)).toBeCloseTo(0.4332, 3);
    expect(savingsRate(0, 100)).toBeNull();
  });
  it('Veränderung', () => {
    expect(change(88, 100)).toBeCloseTo(-0.12);
    expect(change(5, 0)).toBeNull();
  });
  it('Durchschnitt nur über Monate mit Umsätzen', () => {
    expect(averageMonth(e, '2026-10', 3)).toMatchObject({ expense: 5000, months: 1 });
  });
  it('kumulierter Verlauf', () => {
    const c = cumulativeByDay(e, '2026-10');
    expect(c.length).toBe(31);
    expect(c[30]).toBe(s.expense);
  });
});

describe('Budgets', () => {
  it('Stufen', () => {
    expect(budgetLevel(100, 400)).toBe('ok');
    expect(budgetLevel(320, 400)).toBe('warn');
    expect(budgetLevel(400, 400)).toBe('full');
    expect(budgetLevel(401, 400)).toBe('over');
  });
  it('Oberkategorie umfasst Unterkategorien', () => {
    const e = toEntries([tx({ bookingDate: '2026-10-03', amount: -31200, categoryId: 'lebensmittel.supermarkt' })], cats);
    const st = budgetStatus({ id: 'b', categoryId: 'lebensmittel', amount: 40000, createdAt: 0, updatedAt: 0 }, monthSummary(e, '2026-10'));
    expect(st.spent).toBe(31200);
    expect(st.pct).toBeCloseTo(0.78);
    expect(st.level).toBe('ok');
  });
});

describe('Wiederkehrende Zahlungen', () => {
  const monthly = (merchantKey: string, amount: number, dom: string, months: number, categoryId: string) =>
    Array.from({ length: months }, (_, i) => tx({ bookingDate: addMonthsToDay(`2026-${dom}`, i - months + 1), amount, merchantKey, merchant: merchantKey, categoryId }));
  const txs = [
    ...monthly('SPOTIFY', -1199, '10-15', 8, 'freizeit.streaming'),
    ...monthly('HAUSVERWALTUNG', -110000, '10-01', 12, 'wohnen.miete'),
    ...monthly('MUSTER', 325000, '09-28', 6, 'einkommen.gehalt'),
    tx({ bookingDate: '2025-01-02', amount: -42000, merchantKey: 'HUK', categoryId: 'versicherungen' }),
    tx({ bookingDate: '2026-01-02', amount: -42000, merchantKey: 'HUK', categoryId: 'versicherungen' }),
    // unregelmäßig: Supermarkt
    ...['2026-09-02', '2026-09-05', '2026-09-19', '2026-09-20', '2026-10-01', '2026-10-06'].map((d, i) => tx({ bookingDate: d, amount: -2000 - i * 900, merchantKey: 'REWE', categoryId: 'lebensmittel.supermarkt' })),
    // beendetes Abo
    ...monthly('NETFLIX', -1399, '03-22', 5, 'freizeit.streaming')
  ];
  const found = detectRecurring(txs, cats, '2026-10-20');
  const by = new Map(found.map(f => [f.key, f]));
  it('erkennt monatliche Abos und Miete', () => {
    expect(by.get('SPOTIFY|-')).toMatchObject({ interval: 'monthly', amount: -1199, isSubscription: true, isFixedCost: true, nextDate: '2026-11-15' });
    expect(by.get('HAUSVERWALTUNG|-')).toMatchObject({ interval: 'monthly', isSubscription: false, isFixedCost: true });
    expect(by.get('MUSTER|+')).toMatchObject({ interval: 'monthly', isFixedCost: false });
  });
  it('erkennt jährliche Zahlungen', () => {
    expect(by.get('HUK|-')).toMatchObject({ interval: 'yearly', nextDate: '2027-01-02' });
  });
  it('ignoriert unregelmäßige Einkäufe und beendete Abos', () => {
    expect(by.has('REWE|-')).toBe(false);
    expect(by.has('NETFLIX|-')).toBe(false);
  });
  it('Monatsbetrag und nächste Fälligkeit', () => {
    expect(monthlyAmount(-42000, 'yearly')).toBe(-3500);
    expect(nextDue('2026-01-31', 'monthly')).toBe('2026-02-28');
  });
  it('noch offene Fixkosten im Monat', () => {
    const rec = found.map(f => ({ ...f, id: f.key, status: 'detected', source: 'auto', createdAt: 0, updatedAt: 0 }) as Recurring);
    const p = pendingInMonth(rec, '2026-11');
    expect(p.map(x => x.recurring.key)).toContain('SPOTIFY|-');
    expect(p.map(x => x.recurring.key)).not.toContain('MUSTER|+');
    expect(freeToSpend(325000, 100000, p)).toBe(225000 - 1199 - 110000);
  });
});

describe('Geld', () => {
  it('parst und formatiert', () => {
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('abc')).toBeNull();
    expect(fmtMoney(428050)).toMatch(/4\.280,50\s€/);
    expect(fmtMoney(-4999)).toMatch(/^−49,99/);
    expect(fmtMoney(1000, { sign: true })).toMatch(/^\+10,00/);
  });
});
