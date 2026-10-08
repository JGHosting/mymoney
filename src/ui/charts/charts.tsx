/**
 * Schlanke SVG-Diagramme ohne Bibliothek (kleines Bundle, volle Kontrolle über iOS-Touch).
 * Regeln: dünne Linien, eine Achse, Farbe folgt der Kategorie, Werte immer auch als Text.
 */
import { useId, useMemo, useState, type PointerEvent } from 'react';
import { fmtMoney, fmtPct } from '../../core/money';
import { cx } from '../components/ui';

/* ---------- Donut ---------- */

export interface Slice { id: string; label: string; value: number; color: string }

export function Donut({ slices, size = 168, thickness = 22, center, active, onActive }: {
  slices: Slice[]; size?: number; thickness?: number; center?: React.ReactNode; active?: string | null; onActive?: (id: string | null) => void;
}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 3 : 0;      // sichtbare Lücke zwischen Segmenten
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label="Ausgaben nach Kategorie">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
        {total > 0 && slices.map(s => {
          const len = (Math.max(0, s.value) / total) * c;
          const dash = Math.max(0.5, len - gap);
          const el = (
            <circle key={s.id} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={active === s.id ? thickness + 6 : thickness}
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} strokeLinecap="butt"
              style={{ transition: 'stroke-width 200ms, opacity 200ms', opacity: active && active !== s.id ? 0.35 : 1, cursor: 'pointer' }}
              onClick={() => onActive?.(active === s.id ? null : s.id)}>
              <title>{`${s.label}: ${fmtMoney(s.value)}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">{center}</div>
    </div>
  );
}

/* ---------- Gruppierte Monatsbalken (Einnahmen vs. Ausgaben) ---------- */

export interface BarPoint { label: string; a: number; b: number; key: string }

export function PairBars({ data, aLabel, bLabel, aColor = 'var(--pos)', bColor = 'var(--accent)', height = 180, selected, onSelect }: {
  data: BarPoint[]; aLabel: string; bLabel: string; aColor?: string; bColor?: string; height?: number; selected?: string | null; onSelect?: (key: string | null) => void;
}) {
  const max = Math.max(1, ...data.flatMap(d => [d.a, d.b]));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] ?? max;
  const sel = data.find(d => d.key === selected);
  return (
    <div>
      <Legend items={[{ label: aLabel, color: aColor }, { label: bLabel, color: bColor }]} />
      <div className="relative mt-3" style={{ height }}>
        {ticks.map(t => (
          <div key={t} className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${(t / top) * 100}%` }}>
            <div className="h-px flex-1 bg-line" />
            <span className="tnum w-10 translate-y-[-50%] text-right text-[11px] text-ink-3">{shortMoney(t)}</span>
          </div>
        ))}
        <div className="absolute inset-0 right-12 flex items-end justify-around gap-1">
          {data.map(d => (
            <button key={d.key} type="button" onClick={() => onSelect?.(selected === d.key ? null : d.key)}
              aria-label={`${d.label}: ${aLabel} ${fmtMoney(d.a)}, ${bLabel} ${fmtMoney(d.b)}`}
              className={cx('flex h-full flex-1 items-end justify-center gap-[2px] rounded-md transition-opacity', selected && selected !== d.key && 'opacity-40')}>
              <span className="w-[clamp(4px,28%,12px)] rounded-t-[4px]" style={{ height: `${(d.a / top) * 100}%`, background: aColor }} />
              <span className="w-[clamp(4px,28%,12px)] rounded-t-[4px]" style={{ height: `${(d.b / top) * 100}%`, background: bColor }} />
            </button>
          ))}
        </div>
      </div>
      <div className="mr-12 mt-1.5 flex justify-around text-[11px] text-ink-3">
        {data.map(d => <span key={d.key} className={cx('flex-1 text-center', d.key === selected && 'font-semibold text-ink')}>{d.label}</span>)}
      </div>
      {sel && (
        <div className="animate-fade mt-3 flex justify-between rounded-xl bg-surface-2 px-3 py-2 text-[14px]">
          <span className="font-medium">{sel.label}</span>
          <span className="tnum text-ink-2">{aLabel} <b className="text-ink">{fmtMoney(sel.a, { round: true })}</b> · {bLabel} <b className="text-ink">{fmtMoney(sel.b, { round: true })}</b></span>
        </div>
      )}
    </div>
  );
}

/* ---------- Linien (kumulierte Ausgaben, Verlauf) mit Fadenkreuz ---------- */

export interface LineSeries { id: string; label: string; values: (number | null)[]; color: string; dashed?: boolean }

export function LineChart({ series, xLabels, height = 170, valueFmt = (v: number) => fmtMoney(v, { round: true }) }: {
  series: LineSeries[]; xLabels: string[]; height?: number; valueFmt?: (v: number) => string;
}) {
  const uid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(...series.map(s => s.values.length), 2);
  const max = Math.max(1, ...series.flatMap(s => s.values.filter((v): v is number => v != null)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] ?? max;
  const W = 320, H = height;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - (v / top) * (H - 6) - 3;
  const paths = useMemo(() => series.map(s => {
    let d = '';
    s.values.forEach((v, i) => { if (v == null) return; d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
    return d;
  }), [series, top, n]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div>
      {series.length > 1 && <Legend items={series.map(s => ({ label: s.label, color: s.color, dashed: s.dashed }))} />}
      <div className="relative mt-3 flex gap-2">
        <div className="relative flex-1 touch-pan-y" style={{ height: H }} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map(t => <div key={t} className="absolute inset-x-0 h-px bg-line" style={{ top: y(t) }} />)}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <defs>
              <linearGradient id={uid} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={series[0]?.color} stopOpacity="0.16" />
                <stop offset="1" stopColor={series[0]?.color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {series[0] && paths[0] && (() => {
              const vals = series[0].values; let last = -1; vals.forEach((v, i) => { if (v != null) last = i; });
              return last > 0 ? <path d={`${paths[0]}L${x(last)},${H}L0,${H}Z`} fill={`url(#${uid})`} /> : null;
            })()}
            {series.map((s, i) => (
              <path key={s.id} d={paths[i]} fill="none" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke"
                strokeDasharray={s.dashed ? '4 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
            ))}
          </svg>
          {hover != null && (
            <>
              <div className="absolute inset-y-0 w-px bg-ink-3/60" style={{ left: `${(hover / (n - 1)) * 100}%` }} />
              {series.map(s => {
                const v = s.values[hover];
                return v == null ? null : <span key={s.id} className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface" style={{ left: `${(hover / (n - 1)) * 100}%`, top: y(v), background: s.color }} />;
              })}
              <div className="pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-xl bg-ink px-2.5 py-1.5 text-[12px] text-bg shadow-lg"
                style={{ left: `clamp(0px, calc(${(hover / (n - 1)) * 100}% - 60px), calc(100% - 140px))` }}>
                <div className="font-semibold">{xLabels[hover]}</div>
                {series.map(s => s.values[hover] != null && (
                  <div key={s.id} className="tnum flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}: {valueFmt(s.values[hover]!)}</div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="relative w-10 shrink-0" style={{ height: H }}>
          {ticks.map(t => <span key={t} className="tnum absolute right-0 -translate-y-1/2 text-[11px] text-ink-3" style={{ top: y(t) }}>{shortMoney(t)}</span>)}
        </div>
      </div>
      <div className="mr-12 mt-1.5 flex justify-between text-[11px] text-ink-3">
        <span>{xLabels[0]}</span><span>{xLabels[Math.floor((n - 1) / 2)]}</span><span>{xLabels[n - 1]}</span>
      </div>
    </div>
  );
}

/* ---------- Gemeinsames ---------- */

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-[3px] w-3.5 rounded-full" style={{ background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 3px, transparent 3px 5px)` : i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Horizontale Balken mit Beschriftung (Kategorien, Einnahmen/Ausgaben). */
export function HBar({ label, value, max, color, right, icon }: { label: React.ReactNode; value: number; max: number; color: string; right?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-2 text-[15px]">
          <span className="truncate">{label}</span>
          <span className="tnum shrink-0 font-medium">{right ?? fmtMoney(value, { round: true })}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full transition-[width] duration-700 ease-[var(--ease-ios)]" style={{ width: `${max > 0 ? Math.max(1.5, (value / max) * 100) : 0}%`, background: color }} />
        </div>
      </div>
    </div>
  );
}

/** Achsenwerte: 0 und "runde" Schritte bis über das Maximum. */
export function niceTicks(max: number, count = 3): number[] {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Math.round(v));
  return out;
}
export const shortMoney = (c: number) => {
  const e = c / 100;
  return Math.abs(e) >= 1000 ? `${(e / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : `${Math.round(e)}`;
};
export const pctLabel = (v: number) => fmtPct(v);
