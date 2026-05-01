import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface AppShellProps {
  children: ReactNode;
  currentPath?: string;
  showSimulate?: boolean;
}

interface NavItem {
  label: string;
  href: string;
  match: (path: string) => boolean;
}

const baseNavItems: NavItem[] = [
  { label: 'Lobby', href: '/lobby', match: path => path === '/lobby' || path.startsWith('/tables/') },
  { label: 'Agents', href: '/agents', match: path => path.startsWith('/agents') },
  { label: 'Replays', href: '/matches', match: path => path.startsWith('/matches') },
];

const simulateNavItem: NavItem = {
  label: 'Simulate',
  href: '/simulate',
  match: path => path.startsWith('/simulate'),
};

export function AppShell({ children, currentPath = '', showSimulate = false }: AppShellProps) {
  const navItems = showSimulate ? [...baseNavItems, simulateNavItem] : baseNavItems;
  const isTableRoute = currentPath.startsWith('/tables/');
  const shellClassName = isTableRoute
    ? 'app-shell app-shell-table-arena'
    : 'app-shell';

  return (
    <div className={shellClassName}>
      <header className="app-topbar">
        <Link to="/lobby" className="app-brand">
          <span className="app-brand-mark" aria-hidden="true">AP</span>
          <span className="app-brand-copy">
            <span>Agent Poker</span>
            {isTableRoute ? <small>Poker Arena</small> : null}
          </span>
        </Link>
        <nav className="app-nav" aria-label="Primary navigation">
          {navItems.map(item => {
            const active = item.match(currentPath);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={active ? 'app-nav-link app-nav-link-active' : 'app-nav-link'}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {isTableRoute ? (
          <div className="arena-topbar-hud" aria-label="Arena status">
            <span className="arena-latency-pill">24ms</span>
            <span className="arena-chip-wallet">
              <span className="arena-chip-icon" aria-hidden="true" />
              <span>Play chips</span>
              <strong>125,880</strong>
            </span>
          </div>
        ) : null}
      </header>
      <div className="app-content">
        {children}
      </div>
    </div>
  );
}
