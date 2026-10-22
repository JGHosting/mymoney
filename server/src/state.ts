/**
 * Zustand der Bankverbindung (BPD/UPD/System-ID, gewähltes TAN-Verfahren), den die Bank zum Wiedererkennen braucht.
 *
 * Zwei Ablagen:
 * - "file":   auf der Festplatte des Servers (banking-info.json, Rechte 600) – für eigenen Server/VPS.
 * - "client": verschlüsselt in der App. Die Brücke selbst speichert dann gar nichts und läuft auf
 *             Plattformen ohne dauerhafte Festplatte (z. B. Google Cloud Run). Der Schlüssel wird aus
 *             STATE_KEY bzw. BRIDGE_TOKEN abgeleitet; AES-256-GCM sorgt dafür, dass ein veränderter
 *             oder fremder Zustand verworfen wird (dann gilt die Verbindung als neu).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BankingInformation } from 'lib-fints';

export interface Saved { info: BankingInformation; tanMethodId?: number; tanMedia?: string }

export interface InfoStore {
  load(): Saved | undefined;
  save(s: Saved): void;
}

/** Ablage auf der Festplatte (keine Geheimnisse) mit Dateirechten 600. */
export class FileStore implements InfoStore {
  private file: string;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = join(dir, 'banking-info.json');
  }
  load(): Saved | undefined {
    if (!existsSync(this.file)) return undefined;
    try { return JSON.parse(readFileSync(this.file, 'utf8')) as Saved; } catch { return undefined; }
  }
  save(s: Saved) {
    writeFileSync(this.file, JSON.stringify(s), { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }
}

/** Ablage nur für eine Sitzung im Arbeitsspeicher; die App bekommt den Stand verschlüsselt zurück. */
export class MemoryStore implements InfoStore {
  private readonly initial: string;
  constructor(private value?: Saved) { this.initial = JSON.stringify(value ?? null); }
  load() { return this.value; }
  save(s: Saved) { this.value = JSON.parse(JSON.stringify(s)) as Saved; }
  /** Nur ein geänderter Zustand muss zurück an die App. */
  get changed() { return this.value !== undefined && JSON.stringify(this.value) !== this.initial; }
}

const VERSION = 'v1';
const b64 = (b: Buffer) => b.toString('base64url');

export class StateCipher {
  private key: Buffer;
  private aad: Buffer;
  /** `binding` (BLZ + Anmeldename) verhindert, dass ein Zustand für eine andere Bankverbindung genutzt wird. */
  constructor(secret: string, binding: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, 'mymoney-bridge', 'banking-state v1', 32));
    this.aad = Buffer.from(binding);
  }
  seal(s: Saved): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(this.aad);
    const ct = Buffer.concat([c.update(JSON.stringify(s), 'utf8'), c.final(), c.getAuthTag()]);
    return `${VERSION}.${b64(iv)}.${b64(ct)}`;
  }
  /** Liefert undefined bei fehlendem, fremdem oder verändertem Zustand. */
  open(token: unknown): Saved | undefined {
    if (typeof token !== 'string') return undefined;
    const [v, ivS, ctS] = token.split('.');
    if (v !== VERSION || !ivS || !ctS) return undefined;
    try {
      const iv = Buffer.from(ivS, 'base64url'), all = Buffer.from(ctS, 'base64url');
      if (iv.length !== 12 || all.length < 17) return undefined;
      const d = createDecipheriv('aes-256-gcm', this.key, iv);
      d.setAAD(this.aad);
      d.setAuthTag(all.subarray(all.length - 16));
      const plain = Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]).toString('utf8');
      return JSON.parse(plain) as Saved;
    } catch { return undefined; }
  }
}
