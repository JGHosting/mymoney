/** Konten aller Banken, Summe, Umbenennen und Ausblenden. */
import { useState } from 'react';
import { Landmark, PiggyBank, CreditCard, TrendingUp } from 'lucide-react';
import { db, type Account } from '../../core/db';
import { useAccounts } from '../hooks/data';
import { BackBar, Button, Empty, Group, GroupLabel, PageTitle, Row, Toggle } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { fmtMoney } from '../../core/money';
import { fmtTimestamp } from '../../core/dates';
import { useNavigate } from 'react-router';

const ICON = { giro: Landmark, savings: PiggyBank, credit: CreditCard, depot: TrendingUp };

export default function Accounts() {
  const accounts = useAccounts();
  const nav = useNavigate();
  const [edit, setEdit] = useState<Account | null>(null);
  const [name, setName] = useState('');
  if (!accounts) return <BackBar />;
  const byBank = new Map<string, Account[]>();
  for (const a of accounts) byBank.set(a.bankName, [...(byBank.get(a.bankName) ?? []), a]);
  const total = accounts.filter(a => !a.hidden).reduce((s, a) => s + a.balance, 0);
  return (
    <>
      <BackBar to="/mehr" />
      <PageTitle title="Konten" />
      {accounts.length === 0 ? (
        <Empty icon={<Landmark size={28} />} title="Noch keine Konten" text="Verbinde deine Bank, damit deine Konten hier erscheinen." action={<Button variant="primary" onClick={() => nav('/mehr/bank')}>Bankkonto verbinden</Button>} />
      ) : (
        <>
          {[...byBank].map(([bank, list]) => (
            <div key={bank}>
              <GroupLabel>{bank}</GroupLabel>
              <Group>
                {list.map(a => {
                  const Icon = ICON[a.type];
                  return (
                    <Row key={a.id} icon={<span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent"><Icon size={20} /></span>}
                      title={a.name} sub={`${a.iban ? a.iban.replace(/(.{4})/g, '$1 ').trim() : a.externalId} · ${fmtTimestamp(a.balanceAt)}`}
                      value={<span className={`tnum text-ink ${a.hidden ? 'opacity-40' : ''}`}>{fmtMoney(a.balance)}</span>}
                      onClick={() => { setEdit(a); setName(a.name); }} chevron />
                  );
                })}
              </Group>
            </div>
          ))}
          <Group>
            <Row title={<b>Gesamt</b>} value={<b className="tnum text-ink">{fmtMoney(total)}</b>} />
          </Group>
          <p className="mx-4 text-[13px] text-ink-2">Weitere Banken (z. B. Trade Republic) sind vorbereitet und erscheinen hier, sobald sie angebunden sind.</p>
        </>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Konto">
        {edit && (
          <form className="pb-2" onSubmit={async e => { e.preventDefault(); await db.accounts.update(edit.id, { name: name.trim() || edit.name, updatedAt: Date.now() }); setEdit(null); }}>
            <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="acc-name">Name</label>
            <input id="acc-name" value={name} onChange={e => setName(e.target.value)} className="mb-4 w-full rounded-2xl border border-line bg-surface px-4 py-3.5 outline-none focus:border-accent" />
            <div className="mb-5 flex items-center justify-between rounded-[18px] bg-surface px-4 py-3">
              <span><span className="block">In Summen berücksichtigen</span><span className="block text-[13px] text-ink-2">Ausgeblendete Konten zählen nicht zum Kontostand.</span></span>
              <Toggle checked={!edit.hidden} label="In Summen berücksichtigen" onChange={async v => { await db.accounts.update(edit.id, { hidden: v ? undefined : true, updatedAt: Date.now() }); setEdit({ ...edit, hidden: !v || undefined }); }} />
            </div>
            <Button variant="primary" type="submit" className="w-full">Speichern</Button>
          </form>
        )}
      </Sheet>
    </>
  );
}
