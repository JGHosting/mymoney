/** Monatsbudgets je Kategorie mit Warnstufen (80 %, 100 %, überschritten). */
import { useMemo, useState } from 'react';
import { Plus, Target, CircleAlert } from 'lucide-react';
import { useCategories, useEntries, useMonth } from '../hooks/data';
import { Button, Card, CategoryIcon, Empty, PageTitle, Progress, Skeleton, cx } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { CategoryPicker } from '../components/CategoryPicker';
import { MonthSwitch, useSelectedMonth } from '../components/MonthSwitch';
import { fmtMoney, fmtPct, parseMoney } from '../../core/money';
import { daysInMonth } from '../../core/dates';
import { projectSpent, type BudgetStatus } from '../../domain/budgets';
import { monthSummary } from '../../domain/stats';
import { addMonths } from '../../core/dates';
import { saveBudget, deleteBudget } from '../../data/actions';
import { useApp } from '../../store/app';

const TONE = { ok: 'accent', warn: 'warn', full: 'warn', over: 'neg' } as const;

export default function Budgets() {
  const [month, setMonth] = useSelectedMonth();
  const data = useMonth(month);
  const { map } = useCategories();
  const [edit, setEdit] = useState<null | { categoryId?: string; amount?: number; id?: string }>(null);

  const list = (data?.budgets ?? []).slice().sort((a, b) => (map.get(a.budget.categoryId)?.order ?? 0) - (map.get(b.budget.categoryId)?.order ?? 0));
  const total = list.reduce((s, b) => s + b.budget.amount, 0);
  const spent = list.reduce((s, b) => s + b.spent, 0);
  const daysLeft = data?.running ? daysInMonth(month) - data.day + 1 : 0;

  return (
    <>
      <PageTitle title="Budgets" right={<button onClick={() => setEdit({})} aria-label="Budget hinzufügen" className="press grid size-10 place-items-center rounded-full bg-accent text-accent-ink"><Plus size={22} /></button>} />
      <div className="-mt-2 mb-4"><MonthSwitch month={month} onChange={setMonth} /></div>
      {!data ? <Skeleton className="h-40 rounded-[22px]" /> : list.length === 0 ? (
        <Empty icon={<Target size={28} />} title="Noch keine Budgets" text="Lege fest, wie viel du pro Monat für eine Kategorie ausgeben möchtest."
          action={<Button variant="primary" onClick={() => setEdit({})}>Budget anlegen</Button>} />
      ) : (
        <>
          <Card className="mb-6 p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] text-ink-2">Gesamt</span>
              <span className="tnum text-[15px] text-ink-2">{fmtPct(total ? spent / total : 0)}</span>
            </div>
            <div className="tnum mt-0.5 text-[26px] font-semibold tracking-[-0.02em]">{fmtMoney(spent, { round: true })} <span className="text-[17px] font-normal text-ink-2">von {fmtMoney(total, { round: true })}</span></div>
            <Progress value={total ? spent / total : 0} tone={spent > total ? 'neg' : spent / (total || 1) >= 0.8 ? 'warn' : 'accent'} className="mt-3" />
            {data.running && total > spent && <p className="mt-3 text-[15px] text-ink-2">Noch {fmtMoney(total - spent, { round: true })} für {daysLeft} {daysLeft === 1 ? 'Tag' : 'Tage'} – etwa {fmtMoney((total - spent) / daysLeft, { round: true })} pro Tag.</p>}
          </Card>
          <div className="space-y-3">
            {list.map(b => <BudgetCard key={b.budget.id} b={b} running={data.running} day={data.day} days={daysInMonth(month)} onEdit={() => setEdit({ id: b.budget.id, categoryId: b.budget.categoryId, amount: b.budget.amount })} />)}
          </div>
        </>
      )}
      {edit && <BudgetSheet initial={edit} month={month} onClose={() => setEdit(null)} existing={new Set(list.map(b => b.budget.categoryId))} />}
    </>
  );
}

function BudgetCard({ b, running, day, days, onEdit }: { b: BudgetStatus; running: boolean; day: number; days: number; onEdit: () => void }) {
  const { map } = useCategories();
  const cat = map.get(b.budget.categoryId);
  const projected = running ? projectSpent(b.spent, day, days) : b.spent;
  const status = b.level === 'over' ? `Überschritten um ${fmtMoney(-b.remaining, { round: true })}`
    : b.level === 'full' ? 'Budget ausgeschöpft'
    : b.level === 'warn' ? `${fmtPct(b.pct)} erreicht – noch ${fmtMoney(b.remaining, { round: true })}`
    : `Noch ${fmtMoney(b.remaining, { round: true })}`;
  return (
    <button onClick={onEdit} className="press block w-full rounded-[22px] bg-surface p-4 text-left shadow-[var(--shadow)]">
      <div className="flex items-center gap-3">
        <CategoryIcon cat={cat} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-medium">{cat?.name ?? 'Kategorie'}</div>
          <div className={cx('flex items-center gap-1 text-[13px]', b.level === 'over' ? 'text-neg' : b.level === 'ok' ? 'text-ink-2' : 'text-warn')}>
            {b.level !== 'ok' && <CircleAlert size={13} />}{status}
          </div>
        </div>
        <div className="tnum text-right text-[15px]"><b className="text-[17px]">{fmtMoney(b.spent, { round: true })}</b><span className="text-ink-2"> / {fmtMoney(b.budget.amount, { round: true })}</span></div>
      </div>
      <Progress value={b.pct} tone={TONE[b.level]} className="mt-3" />
      {running && b.level === 'ok' && projected > b.budget.amount && (
        <p className="mt-2 text-[13px] text-ink-2">Bei diesem Tempo etwa {fmtMoney(projected, { round: true })} bis Monatsende.</p>
      )}
    </button>
  );
}

function BudgetSheet({ initial, month, onClose, existing }: { initial: { id?: string; categoryId?: string; amount?: number }; month: string; onClose: () => void; existing: Set<string> }) {
  const { list, map } = useCategories();
  const entries = useEntries();
  const toast = useApp(s => s.showToast);
  const [cat, setCat] = useState(initial.categoryId);
  const [text, setText] = useState(initial.amount ? String(initial.amount / 100).replace('.', ',') : '');
  // Vorschlag: Durchschnitt der letzten drei Monate, auf 10 € gerundet
  const suggestion = useMemo(() => {
    if (!cat || !entries) return 0;
    const isRoot = !cat.includes('.');
    let sum = 0, k = 0;
    for (let i = 1; i <= 3; i++) {
      const s = monthSummary(entries, addMonths(month, -i));
      if (!s.count) continue;
      sum += (isRoot ? s.byRoot.get(cat) : s.byCategory.get(cat)) ?? 0; k++;
    }
    return k ? Math.ceil(sum / k / 1000) * 1000 : 0;
  }, [cat, entries, month]);
  const amount = parseMoney(text);
  const choices = list.filter(c => c.kind === 'expense' && (!existing.has(c.id) || c.id === initial.categoryId));
  return (
    <Sheet open onClose={onClose} title={initial.id ? 'Budget bearbeiten' : 'Neues Budget'}>
      {!cat ? <CategoryPicker cats={choices} onPick={setCat} /> : (
        <form className="pb-2" onSubmit={async e => {
          e.preventDefault();
          if (!amount || amount <= 0) return;
          await saveBudget(cat, amount); toast('Budget gespeichert'); onClose();
        }}>
          <button type="button" onClick={() => !initial.id && setCat(undefined)} className="mb-4 flex w-full items-center gap-3 rounded-[18px] bg-surface px-4 py-3 text-left">
            <CategoryIcon cat={map.get(cat)} />
            <span className="flex-1 text-[17px] font-medium">{map.get(cat)?.name}</span>
            {!initial.id && <span className="text-[15px] text-accent">Ändern</span>}
          </button>
          <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="budget-amount">Betrag pro Monat</label>
          <div className="mb-2 flex items-center rounded-2xl border border-line bg-surface px-4 focus-within:border-accent">
            <input id="budget-amount" inputMode="decimal" autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="0" className="tnum min-w-0 flex-1 bg-transparent py-3.5 text-[22px] font-semibold outline-none" />
            <span className="text-[19px] text-ink-2">€</span>
          </div>
          {suggestion > 0 && (
            <button type="button" onClick={() => setText(String(suggestion / 100))} className="mb-4 text-[15px] text-accent">
              Vorschlag: {fmtMoney(suggestion, { round: true })} (Ø der letzten 3 Monate)
            </button>
          )}
          <Button variant="primary" type="submit" className="mt-2 w-full" disabled={!amount || amount <= 0}>Speichern</Button>
          {initial.id && <Button variant="danger" type="button" className="mt-2 w-full" onClick={async () => { await deleteBudget(initial.id!); toast('Budget gelöscht'); onClose(); }}>Budget löschen</Button>}
        </form>
      )}
    </Sheet>
  );
}
