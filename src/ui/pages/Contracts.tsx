/** Fixkosten, Abos und weitere wiederkehrende Zahlungen (erkannt oder selbst markiert). */
import { useState } from 'react';
import { Repeat, Check, X } from 'lucide-react';
import type { Recurring } from '../../core/db';
import { useCategories, useRecurring } from '../hooks/data';
import { BackBar, Button, Card, CategoryIcon, Empty, Group, GroupLabel, PageTitle, Row, Segmented, Toggle, cx } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { fmtMoney } from '../../core/money';
import { fmtDate, today } from '../../core/dates';
import { INTERVAL_LABEL, monthlyAmount } from '../../domain/recurring';
import { updateRecurring, dismissRecurring } from '../../data/actions';
import { useApp } from '../../store/app';
import { useNavigate } from 'react-router';

type Tab = 'fixed' | 'subs' | 'all';

export default function Contracts() {
  const recurring = useRecurring();
  const { map } = useCategories();
  const [tab, setTab] = useState<Tab>('fixed');
  const [sel, setSel] = useState<Recurring | null>(null);
  if (!recurring) return <BackBar />;
  const active = recurring.filter(r => r.status !== 'dismissed');
  const list = active.filter(r => (tab === 'fixed' ? r.isFixedCost : tab === 'subs' ? r.isSubscription : true))
    .sort((a, b) => monthlyAmount(a.amount, a.interval) - monthlyAmount(b.amount, b.interval));
  const monthly = list.filter(r => r.amount < 0).reduce((s, r) => s - monthlyAmount(r.amount, r.interval), 0);
  const fresh = active.filter(r => r.status === 'detected');
  const dismissed = recurring.filter(r => r.status === 'dismissed');

  return (
    <>
      <BackBar to="/mehr" />
      <PageTitle title="Fixkosten & Abos" />
      <Segmented value={tab} onChange={setTab} className="mb-4" options={[{ value: 'fixed', label: 'Fixkosten' }, { value: 'subs', label: 'Abos' }, { value: 'all', label: 'Alle' }]} />
      {active.length === 0 ? (
        <Empty icon={<Repeat size={28} />} title="Noch nichts erkannt" text="Wiederkehrende Zahlungen werden nach dem Sync automatisch erkannt. Du kannst Umsätze auch selbst als wiederkehrend markieren." />
      ) : (
        <>
          <Card className="mb-6 p-5">
            <div className="text-[15px] text-ink-2">{tab === 'subs' ? 'Abos' : tab === 'fixed' ? 'Fixkosten' : 'Wiederkehrende Ausgaben'} pro Monat</div>
            <div className="tnum text-[30px] font-semibold tracking-[-0.025em]">{fmtMoney(monthly, { round: monthly >= 100000 })}</div>
            <div className="text-[13px] text-ink-2">{fmtMoney(monthly * 12, { round: true })} pro Jahr · jährliche Zahlungen anteilig</div>
          </Card>
          {fresh.length > 0 && tab === 'all' && <p className="mx-1 mb-3 text-[15px] text-ink-2">{fresh.length} automatisch erkannt – tippe zum Bestätigen oder Verwerfen.</p>}
          {list.length === 0 ? <p className="mx-1 text-[15px] text-ink-2">Keine Einträge in dieser Ansicht.</p> : (
            <Group>
              {list.map(r => (
                <Row key={r.id} icon={<CategoryIcon cat={map.get(r.categoryId)} />} onClick={() => setSel(r)} chevron={false}
                  title={<span className="flex items-center gap-1.5">{r.merchant}{r.status === 'detected' && <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent">neu</span>}</span>}
                  sub={`${INTERVAL_LABEL[r.interval]} · nächste ${r.nextDate < today() ? 'überfällig' : fmtDate(r.nextDate, { day: 'numeric', month: 'short' })}`}
                  value={<span className={cx('tnum font-medium', r.amount > 0 ? 'text-pos' : 'text-ink')}>{fmtMoney(r.amount, { sign: true })}</span>} />
              ))}
            </Group>
          )}
          {dismissed.length > 0 && tab === 'all' && (
            <>
              <GroupLabel>Verworfen</GroupLabel>
              <Group>{dismissed.map(r => <Row key={r.id} title={<span className="text-ink-2">{r.merchant}</span>} value={fmtMoney(r.amount)} onClick={() => setSel(r)} chevron={false} />)}</Group>
            </>
          )}
        </>
      )}
      {sel && <RecurringSheet r={recurring.find(x => x.id === sel.id) ?? sel} onClose={() => setSel(null)} />}
    </>
  );
}

function RecurringSheet({ r, onClose }: { r: Recurring; onClose: () => void }) {
  const { map } = useCategories();
  const toast = useApp(s => s.showToast);
  const nav = useNavigate();
  return (
    <Sheet open onClose={onClose} title={r.merchant}>
      <div className="pb-2">
        <div className="mb-5 flex flex-col items-center text-center">
          <CategoryIcon cat={map.get(r.categoryId)} size={56} />
          <div className="tnum mt-2 text-[30px] font-semibold">{fmtMoney(r.amount, { sign: true })}</div>
          <div className="text-[15px] text-ink-2">{INTERVAL_LABEL[r.interval]} · {r.count}× gefunden · zuletzt {fmtDate(r.lastDate, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
        </div>
        {r.status === 'detected' && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Button variant="primary" onClick={async () => { await updateRecurring(r.id, { status: 'confirmed' }); toast('Bestätigt'); onClose(); }}><Check size={18} />Bestätigen</Button>
            <Button variant="secondary" onClick={async () => { await dismissRecurring(r.id); toast('Verworfen'); onClose(); }}><X size={18} />Verwerfen</Button>
          </div>
        )}
        {r.status === 'dismissed' && <Button variant="secondary" className="mb-4 w-full" onClick={async () => { await updateRecurring(r.id, { status: 'confirmed' }); onClose(); }}>Doch wiederkehrend</Button>}
        <Group>
          <Row title="Nächste Zahlung" value={fmtDate(r.nextDate, { day: 'numeric', month: 'long', year: 'numeric' })} />
          <Row title="Kategorie" value={map.get(r.categoryId)?.name} />
          {r.amount < 0 && (
            <>
              <div className="flex min-h-[52px] items-center justify-between px-4 py-2"><span>Fixkosten</span><Toggle checked={r.isFixedCost} label="Fixkosten" onChange={v => void updateRecurring(r.id, { isFixedCost: v })} /></div>
              <div className="flex min-h-[52px] items-center justify-between px-4 py-2"><span>Abo</span><Toggle checked={r.isSubscription} label="Abo" onChange={v => void updateRecurring(r.id, { isSubscription: v })} /></div>
            </>
          )}
        </Group>
        <Button variant="ghost" className="w-full" onClick={() => nav(`/umsaetze?q=${encodeURIComponent(r.merchant)}`)}>Zahlungen anzeigen</Button>
        {r.status === 'confirmed' && <Button variant="ghost" className="w-full text-neg" onClick={async () => { await dismissRecurring(r.id); onClose(); }}>Nicht wiederkehrend</Button>}
      </div>
    </Sheet>
  );
}
