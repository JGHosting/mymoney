/** Kategorien verwalten und eigene Regeln einsehen. */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Category, type CategoryColor } from '../../core/db';
import { useCategories } from '../hooks/data';
import { BackBar, Button, CategoryIcon, Group, GroupLabel, PageTitle, Row, Segmented, cx } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { PICKABLE_ICONS, iconFor } from '../icons';
import { saveCategory, deleteCategory, deleteRule } from '../../data/actions';
import { useApp } from '../../store/app';

const COLORS: CategoryColor[] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c12'];

export default function Categories() {
  const { list, map } = useCategories();
  const rules = useLiveQuery(() => db.rules.toArray(), []);
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const toast = useApp(s => s.showToast);
  const roots = list.filter(c => !c.parentId && (kind === 'expense' ? c.kind !== 'income' : c.kind === 'income'));
  return (
    <>
      <BackBar to="/mehr" right={<button onClick={() => setEdit({ kind })} aria-label="Kategorie hinzufügen" className="grid size-10 place-items-center text-accent"><Plus size={24} /></button>} />
      <PageTitle title="Kategorien" />
      <Segmented value={kind} onChange={setKind} className="mb-5" options={[{ value: 'expense', label: 'Ausgaben' }, { value: 'income', label: 'Einnahmen' }]} />
      {roots.map(r => (
        <Group key={r.id}>
          {[r, ...list.filter(c => c.parentId === r.id)].map(c => (
            <Row key={c.id} icon={<CategoryIcon cat={c} size={c.parentId ? 30 : 36} />} title={<span className={cx(!c.parentId && 'font-medium', c.parentId && 'pl-1')}>{c.name}</span>}
              onClick={() => setEdit(c)} chevron />
          ))}
        </Group>
      ))}
      <GroupLabel>Eigene Regeln</GroupLabel>
      <Group footer="Regeln entstehen, wenn du bei einem Umsatz die Kategorie „für alle“ änderst. Sie gelten auch für künftige Umsätze.">
        {(rules ?? []).length === 0 ? <Row title={<span className="text-ink-2">Noch keine eigenen Regeln</span>} /> :
          rules!.map(r => (
            <Row key={r.id} title={r.field === 'merchantKey' ? r.pattern.toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase()) : `„${r.pattern}“`} sub={`→ ${map.get(r.categoryId)?.name ?? r.categoryId}`}
              value={<button aria-label="Regel löschen" onClick={async () => { await deleteRule(r.id); toast('Regel gelöscht'); }} className="grid size-9 place-items-center text-ink-3"><Trash2 size={18} /></button>} />
          ))}
      </Group>
      {edit && <CategorySheet initial={edit} roots={list.filter(c => !c.parentId && c.kind === (edit.kind ?? kind))} onClose={() => setEdit(null)} />}
    </>
  );
}

function CategorySheet({ initial, roots, onClose }: { initial: Partial<Category>; roots: Category[]; onClose: () => void }) {
  const toast = useApp(s => s.showToast);
  const [name, setName] = useState(initial.name ?? '');
  const [parent, setParent] = useState(initial.parentId ?? '');
  const [icon, setIcon] = useState(initial.icon ?? 'tag');
  const [color, setColor] = useState<CategoryColor>(initial.color ?? 'c12');
  const isNew = !initial.id;
  return (
    <Sheet open onClose={onClose} title={isNew ? 'Neue Kategorie' : initial.name}>
      <form className="pb-2" onSubmit={async e => {
        e.preventDefault();
        if (!name.trim()) return;
        await saveCategory({ ...initial, name, kind: initial.kind ?? 'expense', icon, color, ...(parent ? { parentId: parent } : {}) });
        toast('Kategorie gespeichert'); onClose();
      }}>
        <div className="mb-4 flex items-center gap-3">
          <CategoryIcon cat={{ icon, color } as Category} size={48} />
          <input value={name} onChange={e => setName(e.target.value)} autoFocus={isNew} placeholder="Name" aria-label="Name" className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 py-3 outline-none focus:border-accent" />
        </div>
        {isNew && (
          <>
            <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="cat-parent">Gehört zu</label>
            <select id="cat-parent" value={parent} onChange={e => setParent(e.target.value)} className="mb-4 w-full rounded-2xl border border-line bg-surface px-4 py-3">
              <option value="">Eigene Oberkategorie</option>
              {roots.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </>
        )}
        {!parent && !initial.parentId && (
          <>
            <div className="mb-1 text-[13px] font-medium text-ink-2">Symbol</div>
            <div className="mb-4 grid grid-cols-8 gap-2">
              {PICKABLE_ICONS.map(n => { const I = iconFor(n); return (
                <button type="button" key={n} onClick={() => setIcon(n)} aria-label={n} className={cx('grid aspect-square place-items-center rounded-xl', icon === n ? 'bg-accent text-accent-ink' : 'bg-surface')}><I size={18} /></button>
              ); })}
            </div>
            <div className="mb-1 text-[13px] font-medium text-ink-2">Farbe</div>
            <div className="mb-5 flex flex-wrap gap-2">
              {COLORS.map(c => <button type="button" key={c} onClick={() => setColor(c)} aria-label={`Farbe ${c}`} className={cx('size-9 rounded-full ring-offset-2 ring-offset-bg', color === c && 'ring-2 ring-ink')} style={{ background: `var(--${c})` }} />)}
            </div>
          </>
        )}
        <Button variant="primary" type="submit" className="w-full" disabled={!name.trim()}>Speichern</Button>
        {!isNew && !initial.builtin && <Button variant="danger" type="button" className="mt-2 w-full" onClick={async () => { await deleteCategory(initial.id!); toast('Kategorie gelöscht'); onClose(); }}>Kategorie löschen</Button>}
        {initial.builtin && <p className="mt-3 text-center text-[13px] text-ink-2">Eingebaute Kategorien lassen sich umbenennen, aber nicht löschen.</p>}
      </form>
    </Sheet>
  );
}
