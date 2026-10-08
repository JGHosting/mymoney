import { useApp } from '../../store/app';

export function Toast() {
  const toast = useApp(s => s.toast);
  if (!toast) return null;
  return (
    <div role="status" className="animate-rise pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-6" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}>
      <div className="rounded-full bg-ink px-4 py-2.5 text-[15px] font-medium text-bg shadow-lg">{toast}</div>
    </div>
  );
}
