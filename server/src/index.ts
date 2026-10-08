import { loadConfig } from './config.js';
import { buildServer } from './server.js';

let cfg;
try { cfg = loadConfig(); }
catch (e) { console.error((e as Error).message); process.exit(1); }

if (!cfg.allowedOrigins.length) console.warn('Hinweis: ALLOWED_ORIGIN ist leer – die App im Browser kann die Brücke dann nicht aufrufen.');
const app = buildServer(cfg);
app.listen({ host: cfg.host, port: cfg.port })
  .then(addr => console.log(`FinTS-Brücke läuft auf ${addr} (BLZ ${cfg.blz})`))
  .catch(e => { console.error(e); process.exit(1); });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void app.close().then(() => process.exit(0)); });
