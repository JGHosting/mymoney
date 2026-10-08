/**
 * Startseite. Beantwortet in drei Sekunden: Wie viel Geld habe ich? Wie viel habe ich ausgegeben?
 * Wofür? Was sind meine Fixkosten? Wie viel kann ich noch ausgeben?
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Landmark, FlaskConical, Lightbulb, TrendingDown, TrendingUp, ChevronRight } from 'lucide-react';
import { useAccounts, useAllTransactions, useCategories, useEntries, useMonth, useRecurring, type MonthData } from '../hooks/data';
import { BigAmount, Button, Card, CategoryIcon, Empty, Section, Skeleton, cx } from '../components/ui';
import { SyncStatus } from '../components/SyncStatus';
import { Guilloche } from '../components/Guilloche';
import { MonthSwitch, useSelectedMonth } from '../components/MonthSwitch';
import { TxRow } from '../components/TxRow';
import { Donut, type Slice } from '../charts/charts';
import { fmtMoney, fmtPct } from '../../core/money';
import { dayLabel, fmtShortDate, monthName, addMonths, addDays, today, fmtTimestamp } from '../../core/dates';
import { change } from '../../domain/stats';
import { pendingInMonth, freeToSpend, expectedIncomeInMonth } from '../../domain/forecast';
import { monthlyAmount } from '../../domain/recurring';
import { buildInsights } from '../../domain/insights';
import { useApp } from '../../store/app';
import { setActiveProviders, activeProviders } from '../../data/sync';

export default function Dashboard() {
  const [month, setMonth] = useSelectedMonth();
  const accounts = useAccounts();
  const data = useMonth(month);

  if (accounts && accounts.length === 0) return <Welcome />;
  return (
    <>
      <header className="flex items-center justify-between pb-3 pt-1">
        <MonthSwitch month={month} onChange={setMonth} />
        <SyncStatus />
      </header>
      <BalanceCard />
      {!data ? <DashSkeleton /> : (
        <>
          <MonthCard month={month} data={data} />
          <InsightList month={month} data={data} />
          <CategoryCard month={month} data={data} />
          <FixedCostCard month={month} />
          <RecentCard month={month} />
        </>
      )}
    </>
  );
}

function DashSkeleton() {
  return <div className="space-y-3"><Skeleton className="h-44 rounded-[22px]" /><Skeleton className="h-56 rounded-[22px]" /></div>;
}

/* ---------- Kontostand (Hero) ---------- */

function BalanceCard() {
  const accounts = useAccounts();
  const nav = useNavigate();
  if (!accounts) return <Skeleton className="mb-6 h-48 rounded-[26px]" />;
  const visible = accounts.filter(a => !a.hidden);
  const total = visible.reduce((s, a) => s + a.balance, 0);
  const newest = Math.max(0, ...visible.map(a => a.balanceAt));
  return (
    <button onClick={() => nav('/mehr/konten')} aria-label={`Kontostand gesamt ${fmtMoney(total)}`}
      className="press relative mb-7 block w-full overflow-hidden rounded-[26px] p-5 text-left text-white shadow-[0_10px_30px_-12px_rgb(31_42_140/0.55)]"
      style={{ background: 'linear-gradient(135deg, var(--card-1), var(--card-2))' }}>
      <Guilloche />
      <div className="relative">
        <div className="flex items-center justify-between text-[15px] text-white/75">
          <span>Kontostand</span>
          {newest > 0 && <span className="text-[12px]">Stand {fmtTimestamp(newest)}</span>}
        </div>
        <BigAmount cents={total} className="mt-1 block text-[40px] font-semibold leading-tight tracking-[-0.03em]" fracClass="text-[24px] opacity-70" />
        <div className="mt-4 space-y-1.5 border-t border-white/15 pt-3">
          {visible.map(a => (
            <div key={a.id} className="flex items-center justify-between text-[15px]">
              <span className="flex items-center gap-2 text-white/85"><Landmark size={15} className="opacity-70" />{a.bankName.replace(' (Demo)', '')} {a.name}</span>
              <span className="tnum font-medium">{fmtMoney(a.balance)}</span>
            </div>
          ))}
        </div>
      </div>
    </button>
  );
}

/* ---------- Monatsübersicht ---------- */

function MonthCard({ month, data }: { month: string; data: MonthData }) {
  const recurring = useRecurring();
  const { cur, prevSame, running, day } = data;
  const max = Math.max(cur.income, cur.expense, 1);
  const pending = useMemo(() => (recurring && running ? pendingInMonth(recurring, month).filter(p => p.due >= today()) : []), [recurring, month, running]);
  const incoming = useMemo(() => (recurring && running ? expectedIncomeInMonth(recurring, month).filter(p => p.due >= today()) : []), [recurring, month, running]);
  const inSum = incoming.reduce((s, p) => s + p.recurring.amount, 0);
  const outSum = -pending.reduce((s, p) => s + p.recurring.amount, 0);
  const free = freeToSpend(cur.income + inSum, cur.expense, pending);
  const ch = change(cur.expense, prevSame.expense);
  const prevName = monthName(addMonths(month, -1), false);
  return (
    <Section title={running ? 'Diesen Monat' : monthName(month)}>
      <Card className="p-5">
        <Bar label="Einnahmen" value={cur.income} max={max} color="var(--pos)" sign="+" />
        <Bar label="Ausgaben" value={cur.expense} max={max} color="var(--accent)" sign="−" />
        <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
          <div>
            <div className="text-[15px] text-ink-2">Verfügbar</div>
            <div className={cx('tnum text-[28px] font-semibold tracking-[-0.02em]', cur.net < 0 && 'text-neg')}>{fmtMoney(cur.net, { round: Math.abs(cur.net) >= 100000 })}</div>
          </div>
          {ch != null && prevSame.expense > 0 && (
            <div className={cx('flex max-w-[55%] items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium', ch <= 0 ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg')}>
              {ch <= 0 ? <TrendingDown size={15} /> : <TrendingUp size={15} />}
              <span>{fmtPct(Math.abs(ch))} {ch <= 0 ? 'weniger' : 'mehr'} als {running ? `bis ${day}. ${prevName.slice(0, 3)}.` : prevName}</span>
            </div>
          )}
        </div>
        {running && (pending.length > 0 || incoming.length > 0) && (
          <Link to="/mehr/vertraege" className="mt-3 flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
            <span>
              <span className="block text-[15px] font-medium">Noch frei bis Monatsende</span>
              <span className="block text-[13px] text-ink-2">
                {[inSum > 0 && `inkl. erwarteter Einnahmen (+${fmtMoney(inSum, { round: true })})`, outSum > 0 && `nach ${pending.length} offenen Fixkosten (${fmtMoney(outSum, { round: true })})`].filter(Boolean).join(', ')}
              </span>
            </span>
            <span className={cx('tnum text-[19px] font-semibold', free < 0 && 'text-neg')}>{fmtMoney(free, { round: true })}</span>
          </Link>
        )}
      </Card>
    </Section>
  );
}

function Bar({ label, value, max, color, sign }: { label: string; value: number; max: number; color: string; sign: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[15px] text-ink-2">{label}</span>
        <span className="tnum text-[19px] font-semibold">{value ? sign : ''}{fmtMoney(value, { round: true })}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full transition-[width] duration-700 ease-[var(--ease-ios)]" style={{ width: `${(value / max) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

/* ---------- Hinweise ---------- */

function InsightList({ month, data }: { month: string; data: MonthData }) {
  const entries = useEntries();
  const recurring = useRecurring();
  const { map } = useCategories();
  const list = useMemo(() => (entries && recurring ? buildInsights({ entries, month, cats: map, recurring, budgets: data.budgets }) : []), [entries, data, recurring, map, month]);
  if (!list.length) return null;
  return (
    <Section title="Hinweise">
      <Card className="divide-y divide-line px-4 py-1">
        {list.slice(0, 3).map(i => (
          <div key={i.id} className="flex gap-3 py-3 text-[15px] leading-snug">
            <Lightbulb size={18} className={cx('mt-0.5 shrink-0', i.tone === 'good' ? 'text-pos' : i.tone === 'warn' ? 'text-warn' : 'text-ink-3')} />
            <span>{i.text}</span>
          </div>
        ))}
      </Card>
    </Section>
  );
}

/* ---------- Kategorien ---------- */

function CategoryCard({ month, data }: { month: string; data: MonthData }) {
  const { map } = useCategories();
  const [active, setActive] = useState<string | null>(null);
  const nav = useNavigate();
  const rows = [...data.cur.byRoot].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, v]) => s + v, 0);
  // Höchstens 5 Kategorien, Rest als "Weitere"
  const top = rows.slice(0, 5);
  const rest = rows.slice(5).reduce((s, [, v]) => s + v, 0);
  const slices: Slice[] = [
    ...top.map(([id, v]) => ({ id, label: map.get(id)?.name ?? id, value: v, color: `var(--${map.get(id)?.color ?? 'c12'})` })),
    ...(rest > 0 ? [{ id: '_rest', label: 'Weitere', value: rest, color: 'var(--c12)' }] : [])
  ];
  const act = slices.find(s => s.id === active);
  if (!total) return null;
  return (
    <Section title="Wofür" action={<Link to={`/analyse${month ? `?m=${month}` : ''}`} className="text-[15px] text-accent">Analyse</Link>}>
      <Card className="p-5">
        <div className="flex items-center gap-5">
          <Donut slices={slices} size={132} thickness={18} active={active} onActive={setActive}
            center={<div><div className="text-[12px] text-ink-2">{act ? act.label : 'Ausgaben'}</div><div className="tnum text-[17px] font-semibold">{fmtMoney(act ? act.value : total, { round: true })}</div></div>} />
          <div className="min-w-0 flex-1 space-y-1.5">
            {slices.map(s => (
              <button key={s.id} onClick={() => (s.id === '_rest' ? setActive(active === s.id ? null : s.id) : nav(`/umsaetze?cat=${s.id}&m=${month}`))}
                className={cx('flex w-full items-center gap-2 text-left text-[14px] transition-opacity', active && active !== s.id && 'opacity-45')}>
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="tnum shrink-0 text-ink-2">{fmtPct(s.value / total)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 border-t border-line pt-1">
          {top.slice(0, 3).map(([id, v]) => (
            <Link key={id} to={`/umsaetze?cat=${id}&m=${month}`} className="row-press -mx-2 flex items-center gap-3 rounded-xl px-2 py-2">
              <CategoryIcon cat={map.get(id)} size={34} />
              <span className="flex-1 text-[16px]">{map.get(id)?.name}</span>
              <span className="tnum text-[16px] font-medium">{fmtMoney(v, { round: true })}</span>
              <ChevronRight size={16} className="text-ink-3" />
            </Link>
          ))}
        </div>
      </Card>
    </Section>
  );
}

/* ---------- Fixkosten ---------- */

function FixedCostCard({ month }: { month: string }) {
  const recurring = useRecurring();
  const { map } = useCategories();
  if (!recurring) return null;
  const fixed = recurring.filter(r => r.status !== 'dismissed' && r.isFixedCost);
  if (!fixed.length) return null;
  const total = fixed.reduce((s, r) => s - monthlyAmount(r.amount, r.interval), 0);
  const t = today();
  const upcoming = recurring
    .filter(r => r.status !== 'dismissed' && r.amount < 0 && r.nextDate >= t && r.nextDate <= addDays(t, 14))
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
    .slice(0, 4);
  return (
    <Section title="Fixkosten" action={<Link to="/mehr/vertraege" className="text-[15px] text-accent">Alle</Link>}>
      <Card className="p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] text-ink-2">{fixed.length} Verträge & Abos</span>
          <span className="tnum text-[22px] font-semibold tracking-[-0.02em]">{fmtMoney(total, { round: true })}<span className="text-[15px] font-normal text-ink-2"> / Monat</span></span>
        </div>
        {upcoming.length > 0 && month === t.slice(0, 7) && (
          <>
            <div className="mb-1 mt-4 text-[13px] font-medium text-ink-2">Nächste 14 Tage</div>
            {upcoming.map(r => (
              <div key={r.id} className="flex items-center gap-3 py-2">
                <CategoryIcon cat={map.get(r.categoryId)} size={34} />
                <span className="min-w-0 flex-1 truncate text-[16px]">{r.merchant}</span>
                <span className="text-[13px] text-ink-2">{dayLabel(r.nextDate) === 'Heute' ? 'heute' : fmtShortDate(r.nextDate)}</span>
                <span className="tnum w-20 text-right text-[16px] font-medium">{fmtMoney(r.amount)}</span>
              </div>
            ))}
          </>
        )}
      </Card>
    </Section>
  );
}

/* ---------- Letzte Umsätze ---------- */

function RecentCard({ month }: { month: string }) {
  const txs = useAllTransactions();
  const { map } = useCategories();
  const list = (txs ?? []).filter(t => t.bookingDate.startsWith(month)).slice(0, 5);
  if (!list.length) return null;
  return (
    <Section title="Letzte Umsätze" action={<Link to={`/umsaetze?m=${month}`} className="text-[15px] text-accent">Alle</Link>}>
      <div className="overflow-hidden rounded-[18px] bg-surface shadow-[var(--shadow)] [&>*+*]:border-t [&>*+*]:border-line">
        {list.map(t => <TxRow key={t.id} tx={t} cat={map.get(t.categoryId)} />)}
      </div>
    </Section>
  );
}

/* ---------- Erster Start ---------- */

function Welcome() {
  const sync = useApp(s => s.sync);
  const nav = useNavigate();
  const demo = async () => {
    await setActiveProviders([...(await activeProviders()), 'mock']);
    await sync({ providers: ['mock'], userTriggered: true });
  };
  const syncing = useApp(s => s.syncing);
  return (
    <div className="flex min-h-[80vh] flex-col justify-center">
      <Empty
        icon={<Landmark size={28} />}
        title="Noch keine Umsätze"
        text="Synchronisiere dein Bankkonto, um deine ersten Umsätze zu sehen."
        action={<>
          <Button variant="primary" onClick={() => nav('/mehr/bank')}>Bankkonto verbinden</Button>
          <Button variant="secondary" onClick={() => void demo()} disabled={syncing}><FlaskConical size={18} />{syncing ? 'Lade Demo-Daten …' : 'Mit Demo-Daten ausprobieren'}</Button>
        </>}
      />
      <p className="mx-auto max-w-[32ch] text-center text-[13px] text-ink-3">Alle Daten bleiben auf diesem Gerät. Demo-Daten lassen sich später mit einem Tipp wieder entfernen.</p>
    </div>
  );
}
