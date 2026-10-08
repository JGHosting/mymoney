/** Alle Umsätze: Suche, Filter, Gruppierung nach Tag. */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search, SlidersHorizontal, X, Receipt } from 'lucide-react';
import { useAccounts, useAllTransactions, useCategories, useRecurring } from '../hooks/data';
import { Button, Empty, Segmented, Skeleton, cx } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { TxRow } from '../components/TxRow';
import { SyncStatus } from '../components/SyncStatus';
import { dayLabel, monthName, addMonths, thisMonth, parseDay } from '../../core/dates';
import { fmtMoney, parseMoney } from '../../core/money';
import { upper } from '../../domain/normalize';
import { rootOf } from '../../domain/categories';
import type { Category, Transaction } from '../../core/db';

type TypeFilter = 'all' | 'in' | 'out';
const PAGE = 120;

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const txs = useAllTransactions();
  const { map, list: cats } = useCategories();
  const accounts = useAccounts();
  const recurring = useRecurring();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const q = useDeferredValue(query);
  const [showFilter, setShowFilter] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  const f = {
    month: params.get('m') ?? '',
    cat: params.get('cat') ?? '',
    acc: params.get('acc') ?? '',
    type: (params.get('type') ?? 'all') as TypeFilter,
    rec: params.get('rec') === '1',
    sub: params.get('sub') === '1'
  };
  const set = (k: string, v: string | null) => setParams(p => { if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true });
  const subIds = useMemo(() => new Set((recurring ?? []).filter(r => r.isSubscription && r.status !== 'dismissed').map(r => r.id)), [recurring]);
  const accName = useMemo(() => new Map((accounts ?? []).map(a => [a.id, a.name])), [accounts]);

  const filtered = useMemo(() => {
    if (!txs) return undefined;
    const needle = q.trim();
    const amount = parseMoney(needle.replace(/[^\d,.-]/g, ''));
    const isAmount = /^[\d.,\s€+-]+$/.test(needle) && amount != null;
    const nu = upper(needle);
    return txs.filter(t => {
      if (f.month && !t.bookingDate.startsWith(f.month)) return false;
      if (f.cat && !(t.categoryId === f.cat || rootOf(t.categoryId, map) === f.cat || t.splits?.some(s => s.categoryId === f.cat || rootOf(s.categoryId, map) === f.cat))) return false;
      if (f.acc && t.accountId !== f.acc) return false;
      if (f.type === 'in' && t.amount <= 0) return false;
      if (f.type === 'out' && t.amount >= 0) return false;
      if (f.rec && !t.recurringId) return false;
      if (f.sub && !(t.recurringId && subIds.has(t.recurringId))) return false;
      if (!needle) return true;
      if (isAmount) return Math.abs(Math.abs(t.amount) - Math.abs(amount)) <= Math.max(50, Math.abs(amount) * 0.005);
      return matches(t, nu, map);
    });
  }, [txs, q, f.month, f.cat, f.acc, f.type, f.rec, f.sub, map, subIds]);

  // Nachladen beim Scrollen (lange Listen bleiben flüssig)
  useEffect(() => { setLimit(PAGE); }, [q, f.month, f.cat, f.acc, f.type, f.rec, f.sub]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(e => { if (e[0]?.isIntersecting) setLimit(l => l + PAGE); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered]);

  const groups = useMemo(() => {
    const out: { day: string; items: Transaction[]; sum: number }[] = [];
    for (const t of (filtered ?? []).slice(0, limit)) {
      const last = out[out.length - 1];
      if (last?.day === t.bookingDate) { last.items.push(t); last.sum += t.amount; }
      else out.push({ day: t.bookingDate, items: [t], sum: t.amount });
    }
    return out;
  }, [filtered, limit]);

  const active = [f.month && monthName(f.month), f.cat && map.get(f.cat)?.name, f.acc && accName.get(f.acc), f.type === 'in' && 'Einnahmen', f.type === 'out' && 'Ausgaben', f.rec && 'Wiederkehrend', f.sub && 'Abos'].filter(Boolean) as string[];
  const total = (filtered ?? []).reduce((s, t) => s + (t.ignored ? 0 : t.amount), 0);
  const multiAcc = (accounts?.length ?? 0) > 1;

  return (
    <>
      <header className="flex items-end justify-between pb-3 pt-3">
        <h1 className="m-0 text-[30px] font-semibold tracking-[-0.025em]">Umsätze</h1>
        <SyncStatus />
      </header>
      <div className="sticky top-0 z-10 -mx-4 bg-bg/85 px-4 pb-2 pt-1 backdrop-blur-xl">
        <div className="flex gap-2">
          <label className="flex min-h-11 flex-1 items-center gap-2 rounded-2xl bg-surface-2 px-3">
            <Search size={18} className="text-ink-3" />
            <input value={query} onChange={e => { setQuery(e.target.value); set('q', e.target.value || null); }} type="search" enterKeyHint="search"
              placeholder="Händler, Zweck, Betrag …" className="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-ink-3" aria-label="Umsätze durchsuchen" />
            {query && <button onClick={() => { setQuery(''); set('q', null); }} aria-label="Suche leeren" className="text-ink-3"><X size={18} /></button>}
          </label>
          <button onClick={() => setShowFilter(true)} aria-label="Filter"
            className={cx('press relative grid size-11 place-items-center rounded-2xl', active.length ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink')}>
            <SlidersHorizontal size={19} />
            {active.length > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-ink text-[11px] font-semibold text-bg">{active.length}</span>}
          </button>
        </div>
        {(active.length > 0 || q) && filtered && (
          <div className="mt-2 flex items-center gap-2 overflow-x-auto text-[13px]">
            {active.map(a => <span key={a} className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent">{a}</span>)}
            <span className="tnum ml-auto shrink-0 text-ink-2">{filtered.length} · {fmtMoney(total, { round: true })}</span>
            {active.length > 0 && <button className="shrink-0 font-medium text-accent" onClick={() => setParams({}, { replace: true })}>Zurücksetzen</button>}
          </div>
        )}
      </div>

      {!filtered ? <div className="mt-3 space-y-2">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
        : filtered.length === 0 ? (
          txs!.length === 0
            ? <Empty icon={<Receipt size={28} />} title="Noch keine Umsätze" text="Synchronisiere dein Bankkonto, um deine ersten Umsätze zu sehen." />
            : <Empty icon={<Search size={26} />} title="Nichts gefunden" text="Probiere einen anderen Suchbegriff oder entferne Filter." />
        ) : (
          <div className="mt-2">
            {groups.map(g => (
              <section key={g.day} className="mb-4">
                <div className="mb-1.5 flex justify-between px-1 text-[13px] font-medium text-ink-2">
                  <span>{dayLabel(g.day)}</span>
                  <span className="tnum">{fmtMoney(g.sum, { sign: true })}</span>
                </div>
                <div className="overflow-hidden rounded-[18px] bg-surface shadow-[var(--shadow)] [&>*+*]:border-t [&>*+*]:border-line">
                  {g.items.map(t => <TxRow key={t.id} tx={t} cat={map.get(t.categoryId)} account={multiAcc ? accName.get(t.accountId) : undefined} />)}
                </div>
              </section>
            ))}
            {limit < filtered.length && <div ref={sentinel} className="h-10" />}
          </div>
        )}

      <FilterSheet open={showFilter} onClose={() => setShowFilter(false)} f={f} set={set} cats={cats} accounts={accounts ?? []} />
    </>
  );
}

function matches(t: Transaction, nu: string, cats: Map<string, Category>): boolean {
  if (upper(t.merchant).includes(nu) || upper(t.purpose).includes(nu) || upper(t.counterpartyName ?? '').includes(nu)) return true;
  if (upper(t.notes ?? '').includes(nu)) return true;
  const c = cats.get(t.categoryId);
  if (c && (upper(c.name).includes(nu) || upper(cats.get(c.parentId ?? '')?.name ?? '').includes(nu))) return true;
  // Datum: "12.10." oder "Oktober"
  const d = parseDay(t.bookingDate);
  const dm = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
  if (dm.startsWith(nu) && /^\d/.test(nu)) return true;
  return upper(monthName(t.bookingDate.slice(0, 7))).startsWith(nu);
}

function FilterSheet({ open, onClose, f, set, cats, accounts }: {
  open: boolean; onClose: () => void;
  f: { month: string; cat: string; acc: string; type: TypeFilter; rec: boolean; sub: boolean };
  set: (k: string, v: string | null) => void; cats: Category[]; accounts: { id: string; name: string; bankName: string }[];
}) {
  const months = Array.from({ length: 13 }, (_, i) => addMonths(thisMonth(), -i));
  const roots = cats.filter(c => !c.parentId);
  const chip = (on: boolean) => cx('press min-h-9 shrink-0 rounded-full px-3.5 text-[15px] font-medium', on ? 'bg-accent text-accent-ink' : 'bg-surface text-ink');
  return (
    <Sheet open={open} onClose={onClose} title="Filter">
      <div className="space-y-5 pb-3">
        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-2">Art</div>
          <Segmented value={f.type} onChange={v => set('type', v === 'all' ? null : v)} options={[{ value: 'all', label: 'Alle' }, { value: 'out', label: 'Ausgaben' }, { value: 'in', label: 'Einnahmen' }]} />
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-2">Zeitraum</div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button className={chip(!f.month)} onClick={() => set('m', null)}>Alle</button>
            {months.map(m => <button key={m} className={chip(f.month === m)} onClick={() => set('m', m)}>{monthName(m, m.slice(0, 4) !== thisMonth().slice(0, 4))}</button>)}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-2">Kategorie</div>
          <div className="flex flex-wrap gap-2">
            <button className={chip(!f.cat)} onClick={() => set('cat', null)}>Alle</button>
            {roots.map(c => <button key={c.id} className={chip(f.cat === c.id)} onClick={() => set('cat', c.id)}>{c.name}</button>)}
          </div>
        </div>
        {accounts.length > 1 && (
          <div>
            <div className="mb-2 text-[13px] font-medium text-ink-2">Konto</div>
            <div className="flex flex-wrap gap-2">
              <button className={chip(!f.acc)} onClick={() => set('acc', null)}>Alle</button>
              {accounts.map(a => <button key={a.id} className={chip(f.acc === a.id)} onClick={() => set('acc', a.id)}>{a.name}</button>)}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button className={chip(f.rec)} onClick={() => set('rec', f.rec ? null : '1')}>Wiederkehrend</button>
          <button className={chip(f.sub)} onClick={() => set('sub', f.sub ? null : '1')}>Abonnements</button>
        </div>
        <Button variant="primary" className="w-full" onClick={onClose}>Fertig</Button>
      </div>
    </Sheet>
  );
}
