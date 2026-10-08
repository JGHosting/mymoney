import { NavLink } from 'react-router';
import { LayoutGrid, ArrowLeftRight, Target, ChartColumn, Ellipsis } from 'lucide-react';
import { cx } from './ui';

const TABS = [
  { to: '/', label: 'Übersicht', Icon: LayoutGrid, end: true },
  { to: '/umsaetze', label: 'Umsätze', Icon: ArrowLeftRight },
  { to: '/budgets', label: 'Budgets', Icon: Target },
  { to: '/analyse', label: 'Analyse', Icon: ChartColumn },
  { to: '/mehr', label: 'Mehr', Icon: Ellipsis }
];

/** Tab-Leiste wie in iOS: Teil des Gerüsts (kein position:fixed), Beschriftung knapp über dem Home-Balken. */
export function TabBar() {
  return (
    <nav aria-label="Hauptnavigation"
      className="z-30 grid shrink-0 grid-cols-5 border-t border-line bg-bg/80 px-1 pt-1 backdrop-blur-xl backdrop-saturate-150"
      style={{ paddingBottom: 'max(calc(env(safe-area-inset-bottom) - 12px), 8px)' }}>
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end}
          className={({ isActive }) => cx('flex min-h-[46px] flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium', isActive ? 'text-accent' : 'text-ink-3')}>
          {({ isActive }) => (<><Icon size={25} strokeWidth={isActive ? 2.3 : 1.8} /><span>{label}</span></>)}
        </NavLink>
      ))}
    </nav>
  );
}
