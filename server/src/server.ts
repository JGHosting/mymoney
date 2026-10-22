/**
 * HTTP-API der FinTS-Brücke (Vertrag: server/README.md und src/banking/fints/FinTSProvider.ts der App).
 *
 * Sicherheit:
 * - Jede Anfrage braucht den Zugangsschlüssel (Bearer), Vergleich in konstanter Zeit.
 * - CORS nur für die eigene App-Adresse (ALLOWED_ORIGIN).
 * - Nach mehreren falschen Schlüsseln kurzzeitige Sperre.
 * - Keine Protokollierung von Anfrage-Inhalten (PIN/TAN); Fehlerdetails nur von der Bank, ohne Eingaben.
 * - Abgelaufene Sitzungen werden auch ohne Hintergrund-Timer verworfen (Cloud Run drosselt die CPU zwischen Anfragen).
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import type { BridgeConfig } from './config.js';
import { BankSession, defaultFactory, type ClientFactory } from './bank.js';
import { FileStore, MemoryStore, StateCipher, type InfoStore } from './state.js';
import { BridgeError } from './types.js';

const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 3;
const MAX_AUTH_FAILS = 10;
/** Nur der Sitzungsstart darf den (verschlüsselten) Zustand mitbringen; BPD sind einige Dutzend KB groß. */
const STATE_BODY_LIMIT = 512 * 1024;

interface Entry { session: BankSession; memory?: MemoryStore }

const hashToken = (t: string) => createHash('sha256').update(t).digest();
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function buildServer(cfg: BridgeConfig, opts: { factory?: ClientFactory; store?: InfoStore } = {}): FastifyInstance {
  const app = Fastify({ logger: { level: 'warn', redact: ['req.headers.authorization', 'req.body'] }, bodyLimit: 4096, trustProxy: true });
  const clientState = cfg.stateStorage === 'client';
  const fileStore = clientState ? undefined : (opts.store ?? new FileStore(cfg.dataDir));
  const cipher = clientState ? new StateCipher(cfg.stateKey ?? cfg.token, `${cfg.blz}|${cfg.user}`) : undefined;
  const factory = opts.factory ?? defaultFactory;
  const sessions = new Map<string, Entry>();
  const tokenHash = hashToken(cfg.token);
  let fails = 0, lockedUntil = 0;

  // Abgelaufene Sitzungen (inkl. PIN im Speicher) entfernen – regelmäßig und vor jeder Anfrage
  const expire = () => {
    const now = Date.now();
    for (const [id, e] of sessions) if (now - e.session.lastUsed > SESSION_TTL_MS) sessions.delete(id);
  };
  const sweep = setInterval(expire, 30_000);
  sweep.unref();
  app.addHook('onClose', async () => { clearInterval(sweep); sessions.clear(); });

  const cors = (req: FastifyRequest, reply: FastifyReply) => {
    const origin = (req.headers.origin ?? '').replace(/\/+$/, '');
    if (origin && cfg.allowedOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      reply.header('Access-Control-Max-Age', '600');
    }
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
  };

  app.addHook('onRequest', async (req, reply) => {
    expire();
    cors(req, reply);
    if (req.method === 'OPTIONS') return reply.code(204).send();
    if (Date.now() < lockedUntil) return reply.code(429).send({ error: 'config', detail: 'Zu viele Fehlversuche, bitte später erneut.' });
    const h = req.headers.authorization ?? '';
    const given = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!given || !timingSafeEqual(hashToken(given), tokenHash)) {
      if (++fails >= MAX_AUTH_FAILS) { lockedUntil = Date.now() + 5 * 60 * 1000; fails = 0; }
      return reply.code(401).send({ error: 'config', detail: 'Zugangsschlüssel ungültig' });
    }
    fails = 0;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof BridgeError) return reply.code(err.status).send({ error: err.kind, ...(err.detail ? { detail: err.detail } : {}) });
    const code = (err as { statusCode?: number }).statusCode;
    if (code && code >= 400 && code < 500) return reply.code(code).send({ error: 'other', detail: 'Ungültige Anfrage' });
    app.log.error({ msg: err instanceof Error ? err.message : String(err) }, 'Unerwarteter Fehler');
    return reply.code(500).send({ error: 'other' });
  });

  const get = (id: string): BankSession => {
    const e = sessions.get(id);
    if (!e) throw new BridgeError('auth', 410, 'Sitzung abgelaufen');
    return e.session;
  };

  app.get('/api/health', async () => ({ ok: true, configured: true, state: cfg.stateStorage, sessions: sessions.size }));

  app.post<{ Body: { pin?: unknown; state?: unknown } }>('/api/fints/sessions', { bodyLimit: STATE_BODY_LIMIT }, async req => {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].session.lastUsed - b[1].session.lastUsed)[0];
      if (oldest) sessions.delete(oldest[0]);
    }
    const memory = cipher ? new MemoryStore(cipher.open(req.body?.state)) : undefined;
    const store: InfoStore = memory ?? fileStore!;
    const s = await BankSession.open(cfg, pin, store, factory);
    const id = randomUUID();
    sessions.set(id, { session: s, ...(memory ? { memory } : {}) });
    const tan = s.challenge();
    return tan ? { sessionId: id, tan } : { sessionId: id };
  });

  app.post<{ Params: { id: string }; Body: { tan?: unknown } }>('/api/fints/sessions/:id/tan', async req => {
    const s = get(req.params.id);
    const tan = typeof req.body?.tan === 'string' ? req.body.tan : undefined;
    return s.submitTan(tan);
  });

  app.get<{ Params: { id: string } }>('/api/fints/sessions/:id/accounts', async req => get(req.params.id).accounts());

  app.get<{ Params: { id: string; ext: string } }>('/api/fints/sessions/:id/accounts/:ext/balance', async req =>
    get(req.params.id).balance(req.params.ext));

  app.get<{ Params: { id: string; ext: string }; Querystring: { from?: string; to?: string } }>('/api/fints/sessions/:id/accounts/:ext/transactions', async req => {
    const { from, to } = req.query;
    if (!isDay(from) || !isDay(to) || from > to) throw new BridgeError('other', 400, 'Zeitraum ungültig');
    return get(req.params.id).transactions(req.params.ext, from, to);
  });

  /** Beendet die Sitzung. Bei STATE_STORAGE=client kommt der aktualisierte Zustand verschlüsselt zurück. */
  app.delete<{ Params: { id: string } }>('/api/fints/sessions/:id', async req => {
    const e = sessions.get(req.params.id);
    sessions.delete(req.params.id);
    const saved = e?.memory?.changed ? e.memory.load() : undefined;
    return saved && cipher ? { ok: true, state: cipher.seal(saved) } : { ok: true };
  });

  return app;
}
