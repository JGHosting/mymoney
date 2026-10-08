import { lazy, Suspense, useEffect, useRef } from 'react';
import { HashRouter, Outlet, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { TabBar } from './components/TabBar';
import { Prompts } from './components/Prompts';
import { Toast } from './components/Toast';
import { Skeleton } from './components/ui';
import Dashboard from './pages/Dashboard';

// Seltener genutzte Seiten erst bei Bedarf laden (Code Splitting)
const Transactions = lazy(() => import('./pages/Transactions'));
const TransactionDetail = lazy(() => import('./pages/TransactionDetail'));
const Budgets = lazy(() => import('./pages/Budgets'));
const Analysis = lazy(() => import('./pages/Analysis'));
const More = lazy(() => import('./pages/More'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Contracts = lazy(() => import('./pages/Contracts'));
const Categories = lazy(() => import('./pages/Categories'));
const Backup = lazy(() => import('./pages/Backup'));
const Banking = lazy(() => import('./pages/Banking'));
const Privacy = lazy(() => import('./pages/Privacy'));
const General = lazy(() => import('./pages/General'));

function Shell() {
  const loc = useLocation();
  const navType = useNavigationType();
  const main = useRef<HTMLElement>(null);
  const positions = useRef(new Map<string, number>());
  // Scrollposition je Seite merken; bei "Zurück" wiederherstellen, sonst oben beginnen
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const key = loc.pathname + loc.search;
    el.scrollTop = navType === 'POP' ? positions.current.get(key) ?? 0 : 0;
    const save = () => positions.current.set(key, el.scrollTop);
    el.addEventListener('scroll', save, { passive: true });
    return () => el.removeEventListener('scroll', save);
  }, [loc.pathname, loc.search, navType]);

  return (
    <>
      <main ref={main} id="main" className="scroll relative flex-1">
        <div className="mx-auto w-full max-w-xl px-4 pb-10" style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}>
          <Suspense fallback={<div className="space-y-3 pt-16"><Skeleton className="h-8 w-40" /><Skeleton className="h-40" /><Skeleton className="h-24" /></div>}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <TabBar />
      <Prompts />
      <Toast />
    </>
  );
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="umsaetze" element={<Transactions />} />
          <Route path="umsatz/:id" element={<TransactionDetail />} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="analyse" element={<Analysis />} />
          <Route path="mehr" element={<More />} />
          <Route path="mehr/konten" element={<Accounts />} />
          <Route path="mehr/vertraege" element={<Contracts />} />
          <Route path="mehr/kategorien" element={<Categories />} />
          <Route path="mehr/backup" element={<Backup />} />
          <Route path="mehr/bank" element={<Banking />} />
          <Route path="mehr/datenschutz" element={<Privacy />} />
          <Route path="mehr/allgemein" element={<General />} />
          <Route path="*" element={<Dashboard />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
