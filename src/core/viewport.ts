/**
 * Setzt --app-h auf die echte Bildschirmhöhe (aus Basislager übernommen).
 * iOS-Bug: In der installierten Web-App ist der Layout-Viewport teils kürzer als der Bildschirm.
 */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function appHeight(): number {
  let h = window.innerHeight;
  if (isStandalone() && isIOS()) {
    const portrait = matchMedia('(orientation: portrait)').matches;
    const screenH = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
    h = Math.max(h, screenH);
  }
  return h;
}

export function fitViewport() {
  const set = () => document.documentElement.style.setProperty('--app-h', appHeight() + 'px');
  set();
  addEventListener('resize', set);
  addEventListener('orientationchange', () => setTimeout(set, 300));
  visualViewport?.addEventListener('resize', set);
}
