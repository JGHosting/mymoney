/** Kleine Grundbausteine der Oberfläche. */
import { type ReactNode, type ButtonHTMLAttributes } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Category } from '../../core/db';
import { iconFor } from '../icons';
import { fmtMoney, splitMoney } from '../../core/money';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Große Seitenüberschrift wie in iOS. */
export function PageTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 px-1 pb-4 pt-3">
      <div className="min-w-0">
        {sub && <div className="text-[15px] font-medium text-ink-2">{sub}</div>}
        <h1 className="m-0 text-[30px] font-semibold leading-tight tracking-[-0.025em]">{title}</h1>
      </div>
      {right}
    </header>
  );
}

/** Kopfzeile für Unterseiten mit Zurück. */
export function BackBar({ title, right, to }: { title?: string; right?: ReactNode; to?: string }) {
  const nav = useNavigate();
  return (
    <div className="sticky top-0 z-20 -mx-4 mb-1 flex h-12 items-center justify-between bg-bg/85 px-2 backdrop-blur-xl">
      <button onClick={() => (to ? nav(to) : nav(-1))} className="flex h-11 min-w-11 items-center gap-0.5 rounded-xl pr-2 text-[17px] text-accent" aria-label="Zurück">
        <ChevronLeft size={26} strokeWidth={2.2} /> <span>Zurück</span>
      </button>
      {title && <div className="absolute left-1/2 -translate-x-1/2 text-[17px] font-semibold">{title}</div>}
      <div className="flex min-w-11 justify-end">{right}</div>
    </div>
  );
}

export function Section({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('mb-7', className)}>
      {(title || action) && (
        <div className="mb-2 flex items-baseline justify-between px-1">
          {title && <h2 className="m-0 text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('rounded-[var(--radius-card)] bg-surface p-4 shadow-[var(--shadow)]', className)}>{children}</div>;
}

/** Gruppierte Liste (iOS "inset grouped"). */
export function Group({ children, className, footer }: { children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <div className="mb-6">
      <div className={cx('overflow-hidden rounded-[18px] bg-surface shadow-[var(--shadow)] [&>*+*]:border-t [&>*+*]:border-line', className)}>{children}</div>
      {footer && <p className="mx-4 mt-2 text-[13px] leading-snug text-ink-2">{footer}</p>}
    </div>
  );
}
export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="mx-4 mb-1.5 text-[13px] font-medium text-ink-2">{children}</div>;
}

interface RowProps { icon?: ReactNode; title: ReactNode; sub?: ReactNode; value?: ReactNode; to?: string; onClick?: () => void; chevron?: boolean; danger?: boolean }
export function Row({ icon, title, sub, value, to, onClick, chevron, danger }: RowProps) {
  const inner = (
    <>
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-[17px]', danger && 'text-neg')}>{title}</span>
        {sub && <span className="block truncate text-[13px] text-ink-2">{sub}</span>}
      </span>
      {value != null && <span className="shrink-0 text-right text-[17px] text-ink-2">{value}</span>}
      {(chevron ?? !!to) && <ChevronRight size={18} className="shrink-0 text-ink-3" />}
    </>
  );
  const cls = 'flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left row-press';
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

export function CategoryIcon({ cat, size = 40 }: { cat?: Category; size?: number }) {
  const Icon = iconFor(cat?.icon);
  const color = `var(--${cat?.color ?? 'c12'})`;
  return (
    <span className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>
      <Icon size={Math.round(size * 0.48)} strokeWidth={2} />
    </span>
  );
}

/** Betrag: Eingänge grün mit "+", Ausgaben in Tintenfarbe (nicht alles muss farbig sein). */
export function Amount({ cents, className, neutral, currency }: { cents: number; className?: string; neutral?: boolean; currency?: string }) {
  return <span className={cx('tnum whitespace-nowrap', !neutral && cents > 0 && 'text-pos', className)}>{fmtMoney(cents, { sign: !neutral, currency })}</span>;
}

/** Großer Betrag mit kleineren Nachkommastellen. */
export function BigAmount({ cents, className, fracClass }: { cents: number; className?: string; fracClass?: string }) {
  const { sign, whole, frac } = splitMoney(cents);
  return (
    <span className={cx('tnum whitespace-nowrap', className)}>
      {sign}{whole}<span className={cx('opacity-60', fracClass)}>,{frac} €</span>
    </span>
  );
}

export function Progress({ value, tone = 'accent', className }: { value: number; tone?: 'accent' | 'warn' | 'neg' | 'pos'; className?: string }) {
  const color = { accent: 'var(--accent)', warn: 'var(--warn)', neg: 'var(--neg)', pos: 'var(--pos)' }[tone];
  return (
    <div className={cx('h-2 overflow-hidden rounded-full bg-surface-2', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-700 ease-[var(--ease-ios)]" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }} />
    </div>
  );
}

export function Button({ variant = 'secondary', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...rest}
      className={cx(
        'press inline-flex min-h-[50px] items-center justify-center gap-2 rounded-2xl px-5 text-[17px] font-semibold disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-ink',
        variant === 'secondary' && 'bg-surface-2 text-ink',
        variant === 'ghost' && 'text-accent',
        variant === 'danger' && 'bg-neg-soft text-neg',
        className
      )}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx('flex rounded-xl bg-surface-2 p-0.5', className)} role="tablist">
      {options.map(o => (
        <button key={o.value} role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}
          className={cx('min-h-9 flex-1 rounded-[10px] px-2 text-[14px] font-medium transition-colors', o.value === value ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]' : 'text-ink-2')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) { return <div className={cx('skeleton', className)} />; }

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-4 grid size-16 place-items-center rounded-full bg-accent-soft text-accent">{icon}</div>}
      <div className="text-[19px] font-semibold">{title}</div>
      {text && <p className="mt-1.5 max-w-[30ch] text-[15px] text-ink-2">{text}</p>}
      {action && <div className="mt-5 flex w-full max-w-xs flex-col gap-2">{action}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors', checked ? 'bg-pos' : 'bg-surface-2')}>
      <span className={cx('absolute top-[2px] size-[27px] rounded-full bg-white shadow transition-transform duration-200', checked ? 'translate-x-[22px]' : 'translate-x-[2px]')} />
    </button>
  );
}
