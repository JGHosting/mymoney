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

// Gedrückthalten auf Links/Buttons: kein Kontextmenü (iOS: "In neuem Fenster öffnen", Desktop: Rechtsklickmenü auf Links bleibt erlaubt)
document.addEventListener('contextmenu', e => {
  const t = e.target as HTMLElement | null;
  if (t?.closest('a, button') && (e as PointerEvent).pointerType !== 'mouse') e.preventDefault();
});
