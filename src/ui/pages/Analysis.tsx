/** Finanzanalyse: Ausgabenentwicklung, Einnahmen vs. Ausgaben, Sparquote, größte Kategorien und Zahlungen. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAllTransactions, useCategories, useEntries } from '../hooks/data';
import { Card, CategoryIcon, PageTitle, Section, Segmented, Skeleton } from '../components/ui';
import { TxRow } from '../components/TxRow';
import { HBar, LineChart, PairBars } from '../charts/charts';
import { addDays, addMonths, monthShort, thisMonth, today, parseDay, monthStart } from '../../core/dates';
import { fmtMoney, fmtPct } from '../../core/money';
import { largestExpenses, monthlySeries, savingsRate, summarize, change } from '../../domain/stats';

type Period = '7d' | '30d' | '3m' | '6m' | '12m';
const PERIODS: { value: Period; label: string }[] = [
  { value: '7d', label: '7 T' }, { value: '30d', label: '30 T' }, { value: '3m', label: '3 M' }, { value: '6m', label: '6 M' }, { value: '12m', label: '12 M' }
];

export default function Analysis() {
  const [period, setPeriod] = useState<Period>('30d');
  const entries = useEntries();
  const txs = useAllTransactions();
  const { map } = useCategories();
  const [selMonth, setSelMonth] = useState<string | null>(null);

  const r = useMemo(() => {
    if (!entries) return undefined;
    const t = today();
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 0;
    const months = period === '3m' ? 3 : period === '6m' ? 6 : period === '12m' ? 12 : 0;
    const from = days ? addDays(t, -(days - 1)) : monthStart(addMonths(thisMonth(), -(months - 1)));
    const prevFrom = days ? addDays(from, -days) : monthStart(addMonths(thisMonth(), -(2 * months - 1)));
    const prevTo = addDays(from, -1);
    const s = summarize(entries, from, t);
    const prev = summarize(entries, prevFrom, prevTo);
    // Kumulierter Verlauf (Tage) bzw. Monatsreihe
    let line: { labels: string[]; cur: number[]; prev: number[] } | null = null;
    if (days) {
      const labels: string[] = [], cur: number[] = [], pv: number[] = [];
      let a = 0, b = 0;
      for (let i = 0; i < days; i++) {
        const d = addDays(from, i), pd = addDays(prevFrom, i);
        a += summarize(entries, d, d).expense; b += summarize(entries, pd, pd).expense;
        labels.push(parseDay(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }));
        cur.push(a); pv.push(b);
      }
      line = { labels, cur, prev: pv };
    }
    const series = months ? monthlySeries(entries, thisMonth(), months) : null;
    const monthCount = months || days / 30.44;
    return { from, to: t, s, prev, line, series, avgExpense: Math.round(s.expense / Math.max(1, monthCount)), monthsLabel: months };
  }, [entries, period]);

  if (!r || !txs) return <><PageTitle title="Analyse" /><Skeleton className="h-64 rounded-[22px]" /></>;
  const rate = savingsRate(r.s.income, r.s.expense);
  const cats = [...r.s.byRoot].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const maxCat = cats[0]?.[1] ?? 0;
  const biggest = largestExpenses(txs, map, r.from, r.to, 5);
  const ch = change(r.s.expense, r.prev.expense);

  return (
    <>
      <PageTitle title="Analyse" />
      <Segmented value={period} onChange={v => { setPeriod(v); setSelMonth(null); }} options={PERIODS} className="mb-5" />

      <Section title="Ausgabenentwicklung">
        <Card className="p-5">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="tnum text-[26px] font-semibold tracking-[-0.02em]">{fmtMoney(r.s.expense, { round: true })}</span>
            {ch != null && <span className={ch <= 0 ? 'text-[15px] font-medium text-pos' : 'text-[15px] font-medium text-neg'}>{ch <= 0 ? '−' : '+'}{fmtPct(Math.abs(ch))} zum Vorzeitraum</span>}
          </div>
          {r.line && (
            <LineChart xLabels={r.line.labels} series={[
              { id: 'cur', label: period === '7d' ? 'Letzte 7 Tage' : 'Letzte 30 Tage', values: r.line.cur, color: 'var(--accent)' },
              { id: 'prev', label: 'Zeitraum davor', values: r.line.prev, color: 'var(--ink-3)', dashed: true }
            ]} />
          )}
          {r.series && (
            <PairBars data={r.series.map(p => ({ key: p.month, label: monthShort(p.month), a: p.income, b: p.expense }))} aLabel="Einnahmen" bLabel="Ausgaben" selected={selMonth} onSelect={setSelMonth} />
          )}
        </Card>
      </Section>

      <div className="mb-7 grid grid-cols-2 gap-3">
        <Stat label="Einnahmen" value={fmtMoney(r.s.income, { round: true })} />
        <Stat label="Ausgaben" value={fmtMoney(r.s.expense, { round: true })} />
        <Stat label="Sparquote" value={rate == null ? '–' : fmtPct(rate, 1)} tone={rate == null ? undefined : rate >= 0 ? 'pos' : 'neg'} />
        <Stat label="Ø Ausgaben / Monat" value={fmtMoney(r.avgExpense, { round: true })} />
      </div>

      {cats.length > 0 && (
        <Section title="Größte Kategorien">
          <Card className="px-4 py-2">
            {cats.slice(0, 8).map(([id, v]) => (
              <Link key={id} to={`/umsaetze?cat=${id}`} className="block">
                <HBar icon={<CategoryIcon cat={map.get(id)} size={34} />} label={map.get(id)?.name ?? id} value={v} max={maxCat} color={`var(--${map.get(id)?.color ?? 'c12'})`}
                  right={<>{fmtMoney(v, { round: true })} <span className="font-normal text-ink-3">· {fmtPct(v / r.s.expense)}</span></>} />
              </Link>
            ))}
          </Card>
        </Section>
      )}

      {biggest.length > 0 && (
        <Section title="Größte Einzelzahlungen">
          <div className="overflow-hidden rounded-[18px] bg-surface shadow-[var(--shadow)] [&>*+*]:border-t [&>*+*]:border-line">
            {biggest.map(t => <TxRow key={t.id} tx={t} cat={map.get(t.categoryId)} />)}
          </div>
        </Section>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <Card className="p-4">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className={`tnum mt-0.5 text-[21px] font-semibold tracking-[-0.015em] ${tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : ''}`}>{value}</div>
    </Card>
  );
}
