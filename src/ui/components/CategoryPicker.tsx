/** Kategorieauswahl als Liste mit Oberkategorien und eingerückten Unterkategorien. */
import { Check } from 'lucide-react';
import type { Category, TxKind } from '../../core/db';
import { CategoryIcon, cx } from './ui';

export function CategoryPicker({ cats, value, onPick, kinds, rootsOnly }: { cats: Category[]; value?: string; onPick: (id: string) => void; kinds?: TxKind[]; rootsOnly?: boolean }) {
  const roots = cats.filter(c => !c.parentId && (!kinds || kinds.includes(c.kind)));
  return (
    <div className="pb-2">
      {roots.map(r => {
        const children = rootsOnly ? [] : cats.filter(c => c.parentId === r.id);
        return (
          <div key={r.id} className="mb-3 overflow-hidden rounded-[18px] bg-surface [&>*+*]:border-t [&>*+*]:border-line">
            {[r, ...children].map(c => (
              <button key={c.id} onClick={() => onPick(c.id)} className={cx('row-press flex min-h-[50px] w-full items-center gap-3 px-4 py-2 text-left', c.parentId && 'pl-8')}>
                <CategoryIcon cat={c} size={c.parentId ? 30 : 36} />
                <span className={cx('flex-1', !c.parentId && 'font-medium')}>{c.name}</span>
                {value === c.id && <Check size={20} className="text-accent" />}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
