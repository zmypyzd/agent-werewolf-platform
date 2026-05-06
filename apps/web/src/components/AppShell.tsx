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
  { label: 'Werewolf', href: '/werewolf', match: path => path.startsWith('/werewolf') },
];

const simulateNavItem: NavItem = {
  label: 'Simulate',
  href: '/simulate',
  match: path => path.startsWith('/simulate'),
};

export function AppShell({ children, currentPath = '', showSimulate = false }: AppShellProps) {
  const navItems = showSimulate ? [...baseNavItems, simulateNavItem] : baseNavItems;
  // The werewolf module owns its own dark "industrial/mysterious" theme
  // (DESIGN.md). Without this hook, the white poker AppShell sat on top of a
  // dark werewolf room and broke the surveillance-room aesthetic.
  const isWerewolf = currentPath.startsWith('/werewolf');
  const shellClass = isWerewolf ? 'app-shell is-werewolf' : 'app-shell';

  return (
    <div className={shellClass}>
      <header className="app-topbar">
        <Link to="/lobby" className="app-brand">
          <span className="app-brand-mark" aria-hidden="true">AP</span>
          <span className="app-brand-copy">
            <span>Agent Poker</span>
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
      </header>
      <div className="app-content">
        {children}
      </div>
    </div>
  );
}
