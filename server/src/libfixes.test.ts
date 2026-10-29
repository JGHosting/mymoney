import { describe, expect, it } from 'vitest';
import { Mt940Parser, type Statement } from 'lib-fints';
import { collectRemainingPortions, parseNoted } from './libfixes.js';
import { mapStatements } from './mapping.js';

type Answer = { code: number; text: string; params?: string[] };
function msg(answers: Answer[], segments: { header: { segId: string }; part?: number }[] = []) {
  return {
    segments: [...segments],
    hasReturnCode: (c: number) => answers.some(a => a.code === c),
    getHighestReturnCode: () => Math.max(0, ...answers.map(a => a.code)),
    getBankAnswers: () => answers,
    findAllSegments(id: string) { return this.segments.filter(s => s.header.segId === id); },
    findSegment(id: string) { return this.segments.find(s => s.header.segId === id); }
  };
}
const hicaz = (part: number) => ({ header: { segId: 'HICAZ' }, part });

function fakeDialog(replies: ReturnType<typeof msg>[]) {
  const sent: (string | undefined)[] = [];
  const order = { segments: [{ header: { segId: 'HNHBK' }, msgNr: 5 }, { header: { segId: 'HKCAZ' }, continuationMark: undefined as string | undefined }], findSegment: (id: string) => order.segments.find(s => s.header.segId === id) };
  return {
    sent,
    dialog: {
      lastMessageNumber: 5,
      currentInteraction: { segId: 'HKCAZ', responseSegId: 'HICAZ' },
      createCurrentCustomerMessage: () => order,
      handlePartedMessages: async () => undefined,
      httpClient: { sendMessage: async (m: typeof order) => { sent.push(m.segments[1]!.continuationMark); return replies.shift()!; } }
    }
  };
}

describe('Umsätze nach Freigabe (3040-Fortsetzung)', () => {
  it('holt alle restlichen Teile mit Aufsetzpunkt nach', async () => {
    const first = msg([{ code: 20, text: 'ok' }, { code: 3040, text: 'weitere', params: ['A1'] }], [hicaz(1)]);
    const { dialog, sent } = fakeDialog([
      msg([{ code: 3040, text: 'weitere', params: ['A2'] }], [hicaz(2)]),
      msg([{ code: 20, text: 'ok' }], [hicaz(3)])
    ]);
    await collectRemainingPortions(dialog, first);
    expect(sent).toEqual(['A1', 'A2']);
    expect(first.findAllSegments('HICAZ').map(s => s.part)).toEqual([1, 2, 3]);
    expect(dialog.lastMessageNumber).toBe(6);
  });

  it('tut nichts ohne 3040', async () => {
    const first = msg([{ code: 20, text: 'ok' }], [hicaz(1)]);
    const { dialog, sent } = fakeDialog([]);
    await collectRemainingPortions(dialog, first);
    expect(sent).toEqual([]);
  });

  it('meldet Bankfehler bei der Fortsetzung, statt still abzubrechen', async () => {
    const first = msg([{ code: 3040, text: 'weitere', params: ['A1'] }], [hicaz(1)]);
    const { dialog } = fakeDialog([msg([{ code: 9050, text: 'Teilweise fehlerhaft' }])]);
    await expect(collectRemainingPortions(dialog, first)).rejects.toThrow('9050');
  });
});

describe('Unlesbare Kontoauszüge', () => {
  it('werfen einen Fehler statt einer leeren Liste', async () => {
    const { applyLibFixes, StatementParseError } = await import('./libfixes.js');
    const { Dialog } = await import('lib-fints');
    applyLibFixes();
    class FakeCamt { segId = 'HKCAZ'; handleResponse(_r: unknown, c: { statements?: unknown[] }) { console.warn('CAMT parsing failed:', new Error('kaputt')); c.statements = []; } }
    const it = new FakeCamt();
    (Dialog.prototype as unknown as { addCustomerInteraction: (this: unknown, i: unknown) => void })
      .addCustomerInteraction.call({ hasEnded: false, interactions: [{}], currentInteractionIndex: 0, config: { isTransactionSupported: () => true } }, it);
    expect(() => it.handleResponse({}, {})).toThrow(StatementParseError);
    expect(() => it.handleResponse({}, {})).toThrow('kaputt');
  });
});

describe('Vorgemerkte Umsätze', () => {
  // Nachbau von lib-fints' handleResponse (MT940): liest nur bookedTransactions
  const handle = function (this: unknown, r: { findAllSegments(id: string): { bookedTransactions?: string }[] }, c: { statements?: unknown[] }) {
    const raw = r.findAllSegments('HIKAZ').map(s => s.bookedTransactions).filter(Boolean).join('');
    try { c.statements = raw ? new Mt940Parser(raw).parse() : []; } catch (e) { console.warn('MT940 parsing failed:', e); c.statements = []; }
  };
  const mt = (amount: string, purpose: string) =>
    `:20:STARTUMS\r\n:25:72069155/123\r\n:28C:0\r\n:60F:C261028EUR100,00\r\n:61:2610291029D${amount}NMSCNONREF\r\n:86:105?00KARTENZAHLUNG?20${purpose}\r\n:62F:C261029EUR80,00\r\n-`;
  const interaction = { responseSegId: 'HIKAZ' };

  it('liest den zweiten Teil der Antwort und markiert ihn als vorgemerkt', () => {
    const r = msg([], [{ header: { segId: 'HIKAZ' }, bookedTransactions: mt('5,00', 'GEBUCHT'), notedTransactions: mt('12,34', 'REWE') } as never]);
    const noted = parseNoted(interaction, handle as never, r as never, 'MT940') as Statement[];
    const list = mapStatements([], '2026-10-01', '2026-10-29', noted);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ amount: -1234, purpose: 'REWE', pending: true, bookingDate: '2026-10-29' });
  });
  it('ohne vorgemerkte Umsätze: leer; unlesbar: übersprungen statt Fehler', () => {
    expect(parseNoted(interaction, handle as never, msg([], [{ header: { segId: 'HIKAZ' }, bookedTransactions: 'x' } as never]) as never, 'MT940')).toEqual([]);
    const bad = msg([], [{ header: { segId: 'HIKAZ' }, notedTransactions: ':20:X\r\n:61:kaputt' } as never]);
    expect(parseNoted(interaction, handle as never, bad as never, 'MT940')).toEqual([]);
  });
});

describe('Buchungstag in der Zukunft', () => {
  it('Barabhebung heute, gebucht am nächsten Bankarbeitstag, wird nicht verworfen', () => {
    const t = { entryDate: new Date(2026, 10, 2), valueDate: new Date(2026, 9, 29), amount: -100, purpose: 'GA', fundsCode: '', transactionType: '', customerReference: '', bankReference: '' };
    const list = mapStatements([{ transactions: [t] } as never], '2026-10-15', '2026-10-29');
    expect(list.map(x => x.bookingDate)).toEqual(['2026-11-02']);
  });
});
