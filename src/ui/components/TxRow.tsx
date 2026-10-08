import { Link } from 'react-router';
import { Repeat, EyeOff } from 'lucide-react';
import type { Category, Transaction } from '../../core/db';
import { Amount, CategoryIcon, cx } from './ui';

export function TxRow({ tx, cat, account }: { tx: Transaction; cat?: Category; account?: string }) {
  return (
    <Link to={`/umsatz/${tx.id}`} className={cx('row-press flex min-h-[64px] items-center gap-3 px-4 py-2.5', tx.ignored && 'opacity-50')}>
      <CategoryIcon cat={cat} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[17px]">
          <span className="truncate">{tx.merchant}</span>
          {tx.recurringId && <Repeat size={13} className="shrink-0 text-ink-3" aria-label="wiederkehrend" />}
          {tx.ignored && <EyeOff size={13} className="shrink-0 text-ink-3" aria-label="ignoriert" />}
        </span>
        <span className="block truncate text-[13px] text-ink-2">{tx.splits?.length ? 'Aufgeteilt' : cat?.name ?? 'Ohne Kategorie'}{account ? ` · ${account}` : ''}</span>
      </span>
      <Amount cents={tx.amount} className="text-[17px] font-medium" />
    </Link>
  );
}
