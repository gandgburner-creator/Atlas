import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/**
 * Navigation: five root tabs plus a push stack for detail screens.
 *
 * Deliberately not a URL router — the app is a standalone PWA with no
 * shareable URLs and no server. Browser/gesture back is honoured by pushing
 * a history entry per stacked screen, which is what iOS standalone swipes
 * drive.
 */

export type Tab = 'today' | 'body' | 'work' | 'craft' | 'life' | 'progress';

export type Route =
  | { name: 'sleep' }
  | { name: 'training-log' }
  | { name: 'training-history' }
  | { name: 'training-session'; id: number }
  | { name: 'inbody-form' }
  | { name: 'inbody-detail'; id: number }
  | { name: 'projection' }
  | { name: 'settings' };

interface Nav {
  tab: Tab;
  stack: Route[];
  top: Route | null;
  setTab: (t: Tab) => void;
  push: (r: Route) => void;
  pop: () => void;
}

const NavCtx = createContext<Nav | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<Tab>('today');
  const [stack, setStack] = useState<Route[]>([]);

  const push = useCallback((r: Route) => {
    setStack((s) => [...s, r]);
    window.history.pushState({ atlas: true }, '');
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length ? s.slice(0, -1) : s));
  }, []);

  const setTab = useCallback((t: Tab) => {
    setStack([]);
    setTabState(t);
    window.scrollTo(0, 0);
  }, []);

  // Back gesture / hardware back pops the stack instead of leaving the app.
  useEffect(() => {
    const onPop = () => setStack((s) => (s.length ? s.slice(0, -1) : s));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const top = stack[stack.length - 1] ?? null;
  return (
    <NavCtx.Provider value={{ tab, stack, top, setTab, push, pop }}>
      {children}
    </NavCtx.Provider>
  );
}

export function useNav(): Nav {
  const nav = useContext(NavCtx);
  if (!nav) throw new Error('useNav outside NavProvider');
  return nav;
}
