/**
 * Konfiguration ausschließlich über Umgebungsvariablen (.env). Nichts davon gehört ins Repository.
 * Eine Bank-PIN ist bewusst NICHT vorgesehen – sie kommt bei jedem Abruf aus der App.
 */
export interface BridgeConfig {
  fintsUrl: string;
  blz: string;
  user: string;
  productId: string;
  productVersion: string;
  token: string;
  allowedOrigins: string[];
  host: string;
  port: number;
  dataDir: string;
  tanMethodId?: number;
  tanMedia?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const missing: string[] = [];
  const req = (k: string) => { const v = env[k]?.trim(); if (!v) missing.push(k); return v ?? ''; };
  const cfg: BridgeConfig = {
    fintsUrl: req('FINTS_URL'),
    blz: req('FINTS_BLZ'),
    user: req('FINTS_USER'),
    productId: req('FINTS_PRODUCT_ID'),
    productVersion: env.FINTS_PRODUCT_VERSION?.trim() || '1.0',
    token: req('BRIDGE_TOKEN'),
    allowedOrigins: (env.ALLOWED_ORIGIN ?? '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean),
    host: env.HOST?.trim() || '127.0.0.1',
    port: Number(env.PORT || 8787),
    dataDir: env.DATA_DIR?.trim() || './data',
    tanMethodId: env.FINTS_TAN_METHOD ? Number(env.FINTS_TAN_METHOD) : undefined,
    tanMedia: env.FINTS_TAN_MEDIA?.trim() || undefined
  };
  if (missing.length) throw new Error(`Fehlende Umgebungsvariablen: ${missing.join(', ')}`);
  if (cfg.token.length < 32) throw new Error('BRIDGE_TOKEN ist zu kurz (mindestens 32 Zeichen, z. B. `openssl rand -hex 32`).');
  if (!/^https:\/\//.test(cfg.fintsUrl)) throw new Error('FINTS_URL muss mit https:// beginnen.');
  return cfg;
}
