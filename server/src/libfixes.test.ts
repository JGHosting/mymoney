import { describe, expect, it } from 'vitest';
import { collectRemainingPortions } from './libfixes.js';

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
