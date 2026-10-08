// Eigene Konfiguration, damit Vitest nicht die vite.config.ts der App im übergeordneten Ordner lädt
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { root: '.', include: ['src/**/*.test.ts'], environment: 'node' } });
