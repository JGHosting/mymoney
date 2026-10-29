/**
 * Korrekturen an lib-fints 1.5.2, zur Laufzeit eingespielt (einmal, beim Import).
 *
 * 1. Umsätze nach einer Freigabe (TAN/SecureGo) gingen größtenteils verloren:
 *    Die Bank liefert große Umsatzlisten in Teilen (Rückmeldung 3040 + Aufsetzpunkt). lib-fints holt die
 *    weiteren Teile nur, wenn die Antwort auf einen Auftrags-Nachricht folgt. Nach einer Freigabe ist die
 *    Nachricht aber eine reine TAN-Nachricht → es kam nur der erste Teil an, der Rest wurde stillschweigend
 *    verworfen. Hier holen wir die restlichen Teile mit dem Aufsetzpunkt nach.
 *
 * 2. Nicht lesbare Kontoauszüge (CAMT/MT940) führten nur zu console.warn und einer LEEREN Liste.
 *    Jetzt wird daraus ein Fehler (StatementParseError), den die Brücke meldet bzw. mit MT940 erneut versucht.
 *
 * 3. Vorgemerkte Umsätze (Kartenzahlungen, Lastschriften, die die Bank noch nicht gebucht hat) liefert die
 *    Bank im zweiten Teil der Antwort (HICAZ/HIKAZ „notedTransactions“). lib-fints liest nur die gebuchten.
 *    Wir lesen die vorgemerkten mit demselben Parser und legen sie in `clientResponse.notedStatements` ab.
 *    Ein Lesefehler dort ist kein Fehler des Abrufs – die gebuchten Umsätze kommen trotzdem an.
 */
import { Dialog } from 'lib-fints';

export class StatementParseError extends Error {
  constructor(public format: string, detail: string) {
    super(`${format}-Umsätze der Bank konnten nicht gelesen werden: ${detail}`.slice(0, 250));
    this.name = 'StatementParseError';
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Msg = {
  segments: any[];
  hasReturnCode(code: number): boolean;
  getHighestReturnCode(): number;
  getBankAnswers(): { code: number; text: string; params?: string[] }[];
  findAllSegments(id: string): any[];
  findSegment(id: string): any;
};

const TAN_CODES = [30, 3955, 3956, 3957];

/** Nach der Freigabe: restliche Teile (3040) mit dem Aufsetzpunkt nachholen und an die Antwort anhängen. */
export async function collectRemainingPortions(dialog: any, response: Msg): Promise<void> {
  const interaction = dialog.currentInteraction;
  if (!interaction?.responseSegId || !response.hasReturnCode(3040)) return;
  if (TAN_CODES.some(c => response.hasReturnCode(c))) return;   // Freigabe steht noch aus
  if (response.findAllSegments('PARTED').length) return;          // regulärer Weg von lib-fints

  const order = dialog.createCurrentCustomerMessage();            // Auftrag erneut, diesmal mit Aufsetzpunkt
  const segment = order.segments.find((s: any) => s.header?.segId === interaction.segId);
  if (!segment) throw new Error(`Fortsetzung nicht möglich: ${interaction.segId} fehlt`);
  let current: Msg = response;
  for (let i = 0; i < 500 && current.hasReturnCode(3040); i++) {
    const mark = current.getBankAnswers().find(a => a.code === 3040)?.params?.[0];
    if (!mark) throw new Error('Die Bank hat weitere Umsätze angekündigt, aber keinen Aufsetzpunkt geliefert.');
    segment.continuationMark = mark;
    if (i > 0) order.findSegment('HNHBK').msgNr = ++dialog.lastMessageNumber;
    const next: Msg = await dialog.httpClient.sendMessage(order);
    if (TAN_CODES.some(c => next.hasReturnCode(c))) throw new Error('Die Bank verlangt für weitere Umsätze erneut eine Freigabe.');
    if (next.getHighestReturnCode() >= 9000) {
      throw new Error(next.getBankAnswers().filter(a => a.code >= 9000).map(a => `${a.code} ${a.text}`).join('; '));
    }
    const parted = next.findAllSegments('PARTED').length > 0;
    // Mit PARTED holt lib-fints alle weiteren Teile selbst und baut sie in `next` ein.
    if (parted) await dialog.handlePartedMessages(order, next, interaction);
    response.segments.push(...next.findAllSegments(interaction.responseSegId));
    if (parted) return;
    current = next;
  }
}

/** Vorgemerkte Umsätze mit dem Parser von lib-fints lesen: die Segmente so umhängen, als wären es gebuchte. */
export function parseNoted(interaction: any, handle: (r: unknown, c: unknown) => void, response: Msg, format: string): unknown[] {
  const segId = interaction.responseSegId as string;
  const noted = response.findAllSegments(segId).filter(s => {
    const n = s.notedTransactions;
    return Array.isArray(n) ? n.length > 0 : !!n;
  });
  if (!noted.length) return [];
  const fake = { findAllSegments: (id: string) => id === segId ? noted.map(s => ({ ...s, bookedTransactions: s.notedTransactions })) : [] };
  const out: { statements?: unknown[] } = {};
  let failed = false;
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { if (typeof args[0] === 'string' && /parsing failed/i.test(args[0])) failed = true; else warn(...args); };
  try { handle.call(interaction, fake, out); } catch { failed = true; } finally { console.warn = warn; }
  if (failed) { console.warn(`Vorgemerkte ${format}-Umsätze nicht lesbar – übersprungen`); return []; }
  return out.statements ?? [];
}

/** Fängt die stillen Lesefehler von CAMT/MT940 ab und wirft sie stattdessen. */
function makeParseStrict(interaction: any) {
  const proto = Object.getPrototypeOf(interaction);
  const format = interaction.segId === 'HKCAZ' ? 'CAMT' : interaction.segId === 'HKKAZ' ? 'MT940' : '';
  if (!format || proto.__strictParse) return;
  const original = proto.handleResponse;
  proto.handleResponse = function (response: unknown, clientResponse: unknown) {
    let failure: unknown[] | undefined;
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && /parsing failed/i.test(args[0])) failure = args;
      else warn(...args);
    };
    try { original.call(this, response, clientResponse); } finally { console.warn = warn; }
    if (failure) {
      const e = failure[1];
      throw new StatementParseError(format, e instanceof Error ? e.message : String(e));
    }
    (clientResponse as { notedStatements?: unknown[] }).notedStatements = parseNoted(this, original, response as Msg, format);
  };
  proto.__strictParse = true;
}

let applied = false;
export function applyLibFixes() {
  if (applied) return;
  applied = true;
  const D = Dialog.prototype as any;

  const add = D.addCustomerInteraction;
  D.addCustomerInteraction = function (interaction: any, afterCurrent?: boolean) {
    makeParseStrict(interaction);
    return add.call(this, interaction, afterCurrent);
  };

  // continue() wie in lib-fints 1.5.2, ergänzt um collectRemainingPortions nach der TAN-Nachricht.
  D.continue = async function (this: any, tanOrderReference: string, tan?: string) {
    if (!tanOrderReference) throw Error('tanOrderReference must be provided to continue a customer order with a TAN');
    if (!this.config.selectedTanMethod?.isDecoupled && !tan) throw Error('TAN must be provided for non-decoupled TAN methods');
    if (this.hasEnded) throw Error('cannot continue a customer order when dialog has already ended');
    if (!this.currentInteraction) throw new Error('there is no running customer interaction in this dialog to continue');
    let clientResponse: any;
    let isFirstMessage = true;
    do {
      const message = isFirstMessage ? this.createCurrentTanMessage(tanOrderReference, tan) : this.createCurrentCustomerMessage();
      const responseMessage = await this.httpClient.sendMessage(message);
      if (isFirstMessage) await collectRemainingPortions(this, responseMessage);
      await this.handlePartedMessages(message, responseMessage, this.currentInteraction);
      clientResponse = this.currentInteraction.handleClientResponse(responseMessage);
      this.checkEnded(clientResponse);
      this.dialogId = clientResponse.dialogId;
      this.responses.set(this.currentInteraction.segId, clientResponse);
      if (clientResponse.success && !clientResponse.requiresTan) {
        this.currentInteractionIndex++;
        if (this.currentInteractionIndex > 0) this.isInitialized = true;
      }
      isFirstMessage = false;
    } while (!this.hasEnded && this.currentInteractionIndex < this.interactions.length && clientResponse.success && !clientResponse.requiresTan);
    return this.responses;
  };
}
