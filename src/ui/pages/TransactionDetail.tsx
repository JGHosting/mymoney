/** Umsatzdetails: Kategorie, Händler, Notiz, wiederkehrend, ignorieren, aufteilen. */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Split as SplitIcon, Trash2, Plus } from 'lucide-react';
import { db, type Interval, type Split, type Transaction } from '../../core/db';
import { useCategories } from '../hooks/data';
import { BackBar, Button, CategoryIcon, Group, GroupLabel, Row, Toggle, cx } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { CategoryPicker } from '../components/CategoryPicker';
import { fmtDate } from '../../core/dates';
import { fmtMoney, parseMoney, splitMoney } from '../../core/money';
import { setCategory, setIgnored, setNote, renameMerchant, markRecurring, dismissRecurring, setSplits } from '../../data/actions';
import { INTERVAL_LABEL } from '../../domain/recurring';
import { useApp } from '../../store/app';

export default function TransactionDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const tx = useLiveQuery(() => db.transactions.get(id), [id]);
  const account = useLiveQuery(() => (tx ? db.accounts.get(tx.accountId) : undefined), [tx?.accountId]);
  const rec = useLiveQuery(() => (tx?.recurringId ? db.recurring.get(tx.recurringId) : undefined), [tx?.recurringId]);
  const similar = useLiveQuery(() => (tx ? db.transactions.where('merchantKey').equals(tx.merchantKey).count() : 0), [tx?.merchantKey]);
  const { map, list } = useCategories();
  const toast = useApp(s => s.showToast);
  const [sheet, setSheet] = useState<null | 'cat' | 'name' | 'rec' | 'split'>(null);
  const [forAll, setForAll] = useState(true);
  const [note, setNoteText] = useState('');
  useEffect(() => { setNoteText(tx?.notes ?? ''); }, [tx?.notes]);

  if (tx === undefined) return <BackBar />;
  if (tx === null || !tx) return <><BackBar /><p className="text-ink-2">Dieser Umsatz existiert nicht mehr.</p></>;
  const cat = map.get(tx.categoryId);
  const parent = cat?.parentId ? map.get(cat.parentId) : undefined;
  const { sign, whole, frac } = splitMoney(tx.amount);

  return (
    <>
      <BackBar />
      <div className="flex flex-col items-center px-2 pb-7 pt-2 text-center">
        <CategoryIcon cat={cat} size={64} />
        <button onClick={() => setSheet('name')} className="mt-3 flex items-center gap-1.5 text-[20px] font-semibold">
          {tx.merchant}<Pencil size={15} className="text-ink-3" />
        </button>
        <div className={cx('tnum mt-1 text-[40px] font-semibold tracking-[-0.03em]', tx.amount > 0 && 'text-pos')}>
          {tx.amount > 0 ? '+' : sign}{whole}<span className="text-[26px] opacity-60">,{frac} €</span>
        </div>
        <div className="text-[15px] text-ink-2">{fmtDate(tx.bookingDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        {tx.ignored && <div className="mt-2 rounded-full bg-surface-2 px-3 py-1 text-[13px] text-ink-2">Wird in Auswertungen nicht berücksichtigt</div>}
      </div>

      <Group>
        <Row title="Kategorie" value={<span className="text-ink">{tx.splits?.length ? 'Aufgeteilt' : `${parent ? parent.name + ' · ' : ''}${cat?.name ?? '–'}`}</span>} onClick={() => setSheet('cat')} chevron />
        <Row title="Konto" value={account ? `${account.bankName.replace(' (Demo)', '')} ${account.name}` : '–'} />
        <Row title="Wiederkehrend" value={rec && rec.status !== 'dismissed' ? INTERVAL_LABEL[rec.interval] : 'Nein'} onClick={() => setSheet('rec')} chevron />
      </Group>

      {tx.splits?.length ? (
        <>
          <GroupLabel>Aufteilung</GroupLabel>
          <Group>
            {tx.splits.map((s, i) => <Row key={i} icon={<CategoryIcon cat={map.get(s.categoryId)} size={32} />} title={map.get(s.categoryId)?.name ?? s.categoryId} sub={s.note} value={<span className="tnum text-ink">{fmtMoney(s.amount)}</span>} />)}
          </Group>
        </>
      ) : null}

      <GroupLabel>Notiz</GroupLabel>
      <Group>
        <textarea value={note} onChange={e => setNoteText(e.target.value)} onBlur={() => { if (note !== (tx.notes ?? '')) void setNote(tx.id, note).then(() => toast('Notiz gespeichert')); }}
          rows={2} placeholder="Notiz hinzufügen" className="block w-full resize-none bg-transparent px-4 py-3.5 outline-none placeholder:text-ink-3" aria-label="Notiz" />
      </Group>

      <GroupLabel>Bankdaten</GroupLabel>
      <Group>
        {tx.counterpartyName && (
          <div className="px-4 py-3">
            <div className="text-[13px] text-ink-2">{tx.amount < 0 ? 'Empfänger' : 'Auftraggeber'}</div>
            <div className="mt-0.5 text-[15px]">{tx.counterpartyName}</div>
            {tx.counterpartyIban && <div className="tnum mt-0.5 select-text text-[13px] text-ink-2">{tx.counterpartyIban.replace(/(.{4})/g, '$1 ').trim()}</div>}
          </div>
        )}
        <div className="px-4 py-3">
          <div className="text-[13px] text-ink-2">Verwendungszweck</div>
          <div className="mt-0.5 select-text break-words text-[15px]">{tx.purpose || '–'}</div>
        </div>
        {tx.bookingText && <Row title="Buchungsart" value={tx.bookingText} />}
        {tx.valueDate && tx.valueDate !== tx.bookingDate && <Row title="Wertstellung" value={fmtDate(tx.valueDate, { day: '2-digit', month: '2-digit', year: 'numeric' })} />}
        {tx.e2eRef && <Row title="End-to-End-Referenz" value={<span className="text-[13px]">{tx.e2eRef}</span>} />}
        {tx.mandateRef && <Row title="Mandatsreferenz" value={<span className="text-[13px]">{tx.mandateRef}</span>} />}
        {tx.creditorId && <Row title="Gläubiger-ID" value={<span className="text-[13px]">{tx.creditorId}</span>} />}
      </Group>

      <Group>
        <Row icon={<SplitIcon size={20} className="text-accent" />} title={tx.splits?.length ? 'Aufteilung bearbeiten' : 'Umsatz aufteilen'} onClick={() => setSheet('split')} chevron />
        <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-2">
          <span>
            <span className="block text-[17px]">Ignorieren</span>
            <span className="block text-[13px] text-ink-2">Nicht in Ausgaben, Budgets und Analysen</span>
          </span>
          <Toggle checked={!!tx.ignored} label="Ignorieren" onChange={v => void setIgnored(tx.id, v)} />
        </div>
      </Group>

      {/* Kategorie */}
      <Sheet open={sheet === 'cat'} onClose={() => setSheet(null)} title="Kategorie">
        {(similar ?? 0) > 1 && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-[18px] bg-surface px-4 py-3">
            <span className="text-[15px]">Für alle {similar} Umsätze von {tx.merchant} übernehmen</span>
            <Toggle checked={forAll} onChange={setForAll} label="Für alle übernehmen" />
          </div>
        )}
        <CategoryPicker cats={list} value={tx.categoryId} onPick={async c => {
          setSheet(null);
          await setCategory(tx, c, forAll && (similar ?? 0) > 1);
          toast(forAll && (similar ?? 0) > 1 ? 'Kategorie für alle übernommen' : 'Kategorie geändert');
        }} />
      </Sheet>

      {/* Händlername */}
      <NameSheet open={sheet === 'name'} onClose={() => setSheet(null)} tx={tx} onSave={async name => { await renameMerchant(tx.merchantKey, name); setSheet(null); toast('Händler umbenannt'); }} />

      {/* Wiederkehrend */}
      <RecurringSheet open={sheet === 'rec'} onClose={() => setSheet(null)} current={rec && rec.status !== 'dismissed' ? rec.interval : null}
        onPick={async iv => {
          setSheet(null);
          if (iv) { await markRecurring(tx, iv); toast('Als wiederkehrend markiert'); }
          else if (rec) { await dismissRecurring(rec.id); toast('Nicht mehr wiederkehrend'); }
        }} />

      {/* Aufteilen */}
      {sheet === 'split' && <SplitSheet tx={tx} onClose={() => setSheet(null)} onSave={async s => { await setSplits(tx, s); setSheet(null); toast(s.length ? 'Aufgeteilt' : 'Aufteilung entfernt'); }} />}

      <div className="h-4" />
      <Button variant="ghost" className="w-full" onClick={() => nav(`/umsaetze?q=${encodeURIComponent(tx.merchant)}`)}>Alle Umsätze von {tx.merchant}</Button>
    </>
  );
}

function NameSheet({ open, onClose, tx, onSave }: { open: boolean; onClose: () => void; tx: Transaction; onSave: (n: string) => void }) {
  const [v, setV] = useState(tx.merchant);
  useEffect(() => { if (open) setV(tx.merchant); }, [open, tx.merchant]);
  return (
    <Sheet open={open} onClose={onClose} title="Händler umbenennen">
      <form onSubmit={e => { e.preventDefault(); onSave(v); }} className="pb-2">
        <input value={v} onChange={e => setV(e.target.value)} autoFocus aria-label="Händlername" className="mb-2 w-full rounded-2xl border border-line bg-surface px-4 py-3.5 outline-none focus:border-accent" />
        <p className="mb-4 text-[13px] text-ink-2">Gilt für alle Umsätze dieses Händlers. Leer lassen, um den ursprünglichen Namen wiederherzustellen.</p>
        <Button variant="primary" type="submit" className="w-full">Speichern</Button>
      </form>
    </Sheet>
  );
}

function RecurringSheet({ open, onClose, current, onPick }: { open: boolean; onClose: () => void; current: Interval | null; onPick: (iv: Interval | null) => void }) {
  const opts: (Interval | null)[] = ['monthly', 'quarterly', 'halfyearly', 'yearly', 'weekly', null];
  return (
    <Sheet open={open} onClose={onClose} title="Wiederkehrend">
      <Group>
        {opts.map(o => (
          <Row key={o ?? 'none'} title={o ? INTERVAL_LABEL[o][0]!.toUpperCase() + INTERVAL_LABEL[o].slice(1) : 'Nicht wiederkehrend'} onClick={() => onPick(o)}
            value={current === o ? <span className="text-accent">✓</span> : undefined} chevron={false} />
        ))}
      </Group>
    </Sheet>
  );
}

function SplitSheet({ tx, onClose, onSave }: { tx: Transaction; onClose: () => void; onSave: (s: Split[]) => void }) {
  const { list, map } = useCategories();
  const sign = tx.amount < 0 ? -1 : 1;
  const init = tx.splits?.length ? tx.splits : [{ categoryId: tx.categoryId, amount: tx.amount }];
  const [rows, setRows] = useState(init.map(s => ({ categoryId: s.categoryId, text: (Math.abs(s.amount) / 100).toFixed(2).replace('.', ','), note: s.note ?? '' })));
  const [pick, setPick] = useState<number | null>(null);
  const parsed = rows.map(r => parseMoney(r.text));
  const sum = parsed.reduce<number>((s, v) => s + (v ?? 0), 0);
  const rest = Math.abs(tx.amount) - sum;
  const valid = parsed.every(v => v != null && v > 0) && rest === 0 && rows.length >= 2;
  return (
    <Sheet open onClose={onClose} title="Umsatz aufteilen">
      {pick != null ? (
        <CategoryPicker cats={list} value={rows[pick]?.categoryId} onPick={c => { setRows(rs => rs.map((r, i) => (i === pick ? { ...r, categoryId: c } : r))); setPick(null); }} />
      ) : (
        <div className="pb-2">
          <p className="mb-3 text-[15px] text-ink-2">Verteile {fmtMoney(Math.abs(tx.amount))} auf mehrere Kategorien.</p>
          {rows.map((r, i) => (
            <div key={i} className="mb-2 flex items-center gap-2 rounded-[18px] bg-surface p-2 pl-3">
              <button onClick={() => setPick(i)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <CategoryIcon cat={map.get(r.categoryId)} size={32} />
                <span className="truncate text-[15px]">{map.get(r.categoryId)?.name}</span>
              </button>
              <input inputMode="decimal" value={r.text} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                aria-label="Betrag" className="tnum w-24 rounded-xl bg-surface-2 px-2 py-2 text-right outline-none" />
              <button aria-label="Teil entfernen" disabled={rows.length <= 1} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="grid size-9 place-items-center text-ink-3 disabled:opacity-30"><Trash2 size={18} /></button>
            </div>
          ))}
          <button onClick={() => setRows(rs => [...rs, { categoryId: 'sonstiges', text: rest > 0 ? (rest / 100).toFixed(2).replace('.', ',') : '', note: '' }])}
            className="mb-3 flex min-h-11 items-center gap-2 px-2 font-medium text-accent"><Plus size={18} />Teil hinzufügen</button>
          <div className={cx('tnum mb-4 px-2 text-[15px]', rest === 0 ? 'text-ink-2' : 'text-warn')}>{rest === 0 ? 'Vollständig verteilt' : `Noch zu verteilen: ${fmtMoney(rest)}`}</div>
          <Button variant="primary" className="w-full" disabled={!valid}
            onClick={() => onSave(rows.map((r, i) => ({ categoryId: r.categoryId, amount: sign * (parsed[i] ?? 0), ...(r.note ? { note: r.note } : {}) })))}>Speichern</Button>
          {tx.splits?.length ? <Button variant="ghost" className="mt-1 w-full" onClick={() => onSave([])}>Aufteilung entfernen</Button> : null}
        </div>
      )}
    </Sheet>
  );
}

