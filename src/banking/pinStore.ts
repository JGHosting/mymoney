/**
 * PIN merken – zwei Stufen, Einstellung `pinMode`:
 *
 * - 'session': PIN nur im Arbeitsspeicher, solange die App läuft. Nach 30 Minuten im Hintergrund vergessen.
 * - 'faceid':  zusätzlich verschlüsselt auf dem Gerät (`pinVault`). Der Schlüssel entsteht aus einem Passkey
 *              (WebAuthn-Erweiterung PRF, iOS 18+) und ist nur nach Face ID verfügbar. Ohne den Passkey ist der
 *              gespeicherte Wert wertlos. Geht der Passkey verloren, wird die PIN einfach neu eingegeben.
 *
 * Nie auf den Server, nie ins Backup (EXCLUDED_SETTINGS). Lehnt die Bank die PIN ab, wird alles sofort vergessen –
 * eine gemerkte PIN wird nie ein zweites Mal versucht (Sperrgefahr).
 */
import type { MyMoneyDB } from '../core/db';
import { db as mainDb, deleteSetting, getSetting, setSetting } from '../core/db';

export type PinMode = 'ask' | 'session' | 'faceid';
/** Passkey (bleibt, auch wenn die PIN vergessen wird) */
interface PinCred { credId: string; salt: string }
/** Verschlüsselte PIN */
interface PinVault { credId: string; iv: string; ct: string }

export const PIN_SETTINGS = ['pinCred', 'pinVault'] as const;
const BACKGROUND_FORGET_MS = 30 * 60 * 1000;
const INFO = new TextEncoder().encode('MyMoney Bank-PIN v1');

/* ---------- Stufe A: Arbeitsspeicher ---------- */
let sessionPin: string | null = null;
let hiddenAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > BACKGROUND_FORGET_MS) sessionPin = null;
  });
}
export const getSessionPin = () => sessionPin;
export const rememberSession = (pin: string) => { sessionPin = pin; };

export async function getPinMode(d: MyMoneyDB = mainDb): Promise<PinMode> {
  try { return (await getSetting<PinMode>('pinMode', d)) ?? 'ask'; } catch { return 'ask'; }   // ohne IndexedDB (Tests der Brücke)
}
export async function setPinMode(mode: PinMode, d: MyMoneyDB = mainDb) {
  await setSetting('pinMode', mode, d);
  if (mode === 'ask') sessionPin = null;
  if (mode !== 'faceid') await deleteSetting('pinVault', d);
}

/** Bank hat die PIN abgelehnt (oder Nutzer will es): alles vergessen. Der Passkey bleibt für eine neue Einrichtung. */
export async function forgetPin(d: MyMoneyDB = mainDb) {
  sessionPin = null;
  await deleteSetting('pinVault', d);
}

/* ---------- Stufe B: Face ID (WebAuthn PRF) ---------- */
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function faceIdAvailable(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential || !crypto?.subtle) return false;
    if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return false;
    // getClientCapabilities gibt es erst in neueren Safari-Versionen – fehlt es, entscheidet der Versuch
    const caps = await (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities?.();
    return caps ? caps['extension:prf'] !== false : true;
  } catch { return false; }
}

export const hasVault = async (d: MyMoneyDB = mainDb) => !!(await getSetting<PinVault>('pinVault', d));
export const hasCred = async (d: MyMoneyDB = mainDb) => !!(await getSetting<PinCred>('pinCred', d));

export class FaceIdError extends Error {}

/** Schritt 1 der Einrichtung (braucht einen Fingertipp): Passkey anlegen. */
export async function createPasskey(d: MyMoneyDB = mainDb): Promise<void> {
  const salt = rnd(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'MyMoney', id: location.hostname },
      user: { id: rnd(16), name: 'MyMoney Bank-PIN', displayName: 'MyMoney – Bank-PIN' },
      challenge: rnd(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs
    }
  }) as PublicKeyCredential | null;
  if (!cred) throw new FaceIdError('Kein Passkey angelegt.');
  const prf = (cred.getClientExtensionResults() as { prf?: { enabled?: boolean } }).prf;
  if (prf && prf.enabled === false) throw new FaceIdError('Dieses Gerät unterstützt das Verschlüsseln mit Face ID nicht (ab iOS 18).');
  await setSetting('pinCred', { credId: b64(cred.rawId), salt: b64(salt) } satisfies PinCred, d);
}

/** Face ID abfragen und daraus den AES-Schlüssel ableiten. */
async function unlockKey(c: PinCred): Promise<CryptoKey> {
  const a = await navigator.credentials.get({
    publicKey: {
      challenge: rnd(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: unb64(c.credId) }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: unb64(c.salt) } } } as AuthenticationExtensionsClientInputs
    }
  }) as PublicKeyCredential | null;
  const out = (a?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } } | undefined)?.prf?.results?.first;
  if (!out) throw new FaceIdError('Face ID hat keinen Schlüssel geliefert. Dieses Gerät unterstützt das Verfahren wohl nicht.');
  const base = await crypto.subtle.importKey('raw', out, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Schritt 2 (Fingertipp): PIN mit Face ID verschlüsselt speichern. */
export async function storePin(pin: string, d: MyMoneyDB = mainDb): Promise<void> {
  const c = await getSetting<PinCred>('pinCred', d);
  if (!c) throw new FaceIdError('Erst Face ID einrichten.');
  const key = await unlockKey(c);
  const iv = rnd(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(pin));
  await setSetting('pinVault', { credId: c.credId, iv: b64(iv), ct: b64(ct) } satisfies PinVault, d);
  sessionPin = pin;
}

/** Gespeicherte PIN mit Face ID entschlüsseln. null = keine gespeichert. */
export async function unlockPin(d: MyMoneyDB = mainDb): Promise<string | null> {
  const [c, v] = await Promise.all([getSetting<PinCred>('pinCred', d), getSetting<PinVault>('pinVault', d)]);
  if (!c || !v || v.credId !== c.credId) return null;
  const key = await unlockKey(c);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, key, unb64(v.ct));
    const pin = new TextDecoder().decode(pt);
    sessionPin = pin;
    return pin;
  } catch {
    await deleteSetting('pinVault', d);   // passt nicht zum Passkey → unbrauchbar
    throw new FaceIdError('Gespeicherte PIN ließ sich nicht entschlüsseln und wurde gelöscht.');
  }
}

/** Face ID komplett entfernen (der Passkey selbst bleibt im iCloud-Schlüsselbund und kann dort gelöscht werden). */
export async function removeFaceId(d: MyMoneyDB = mainDb) {
  await deleteSetting('pinVault', d);
  await deleteSetting('pinCred', d);
}

/** Anbindung an den FinTSProvider. */
export const pinMemory = {
  recall: async () => ((await getPinMode()) !== 'ask' ? sessionPin : null),
  remember: async (pin: string) => { if ((await getPinMode()) !== 'ask') sessionPin = pin; },
  forget: () => forgetPin()
};
