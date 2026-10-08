import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './ui/App';
import { fitViewport } from './core/viewport';
import { ensureBuiltins } from './core/db';
import { useApp } from './store/app';

fitViewport();
void ensureBuiltins();
void useApp.getState().init();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// iOS ignoriert user-scalable=no teilweise → Pinch-Zoom-Gesten zusätzlich abfangen
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
