/** Bottom Sheet: fährt von unten ein, schließt per Wisch nach unten, Tipp auf den Hintergrund oder Escape. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './ui';

export function Sheet({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; className?: string }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="animate-fade absolute inset-0 bg-black/35" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={cx('animate-sheet relative flex max-h-[92%] w-full max-w-xl flex-col rounded-t-[26px] bg-bg outline-none', className)}
        style={{ transform: drag ? `translateY(${drag}px)` : undefined, transition: start.current == null ? 'transform 250ms var(--ease-ios)' : 'none', paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none flex-col items-center px-4 pb-1 pt-2"
          onPointerDown={e => { start.current = e.clientY; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={e => { if (start.current != null) setDrag(Math.max(0, e.clientY - start.current)); }}
          onPointerUp={() => { const d = drag; start.current = null; setDrag(0); if (d > 110) onClose(); }}
          onPointerCancel={() => { start.current = null; setDrag(0); }}
        >
          <div className="h-[5px] w-9 rounded-full bg-ink-3/50" />
          {title && <div className="mt-3 text-[17px] font-semibold">{title}</div>}
        </div>
        <div className="scroll min-h-0 flex-1 px-4 pt-2">{children}</div>
      </div>
    </div>,
    document.body
  );
}
