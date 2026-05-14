import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signOut, useSession } from '../lib/auth.js';
import { InvitePopover } from './InvitePopover.js';

export interface AppShellProps {
  children: ReactNode;
  currentPath?: string;
}

export function AppShell({ children, currentPath = '' }: AppShellProps) {
  const isWerewolf = currentPath.startsWith('/werewolf');
  const shellClass = isWerewolf ? 'app-shell is-werewolf' : 'app-shell';
  const { user, isLoading } = useSession();
  const navigate = useNavigate();
  const [showInvite, setShowInvite] = useState(false);

  const isAuthed = Boolean(user);

  async function onLogout() {
    await signOut();
    navigate('/', { replace: true });
  }

  function onLogin() {
    const next = encodeURIComponent(currentPath || '/');
    navigate(`/login?next=${next}`);
  }

  return (
    <div className={shellClass}>
      <header className="app-topbar">
        <Link to="/" className="app-brand">
          <span className="app-brand-mark" aria-hidden="true">AA</span>
          <span className="app-brand-copy">
            <span>Agent Arena</span>
          </span>
        </Link>
        <div className="app-topbar-actions">
          <div className="invite-anchor">
            <button
              type="button"
              className="app-topbar-button"
              aria-haspopup="dialog"
              aria-expanded={showInvite}
              onClick={() => setShowInvite((open) => !open)}
            >
              邀请
            </button>
            {showInvite ? (
              <InvitePopover
                isAuthed={isAuthed}
                onClose={() => setShowInvite(false)}
              />
            ) : null}
          </div>
          {isLoading ? null : isAuthed ? (
            <button
              type="button"
              className="app-topbar-button"
              onClick={() => void onLogout()}
            >
              登出
            </button>
          ) : (
            <button
              type="button"
              className="app-topbar-button"
              onClick={onLogin}
            >
              登录
            </button>
          )}
        </div>
      </header>
      <div className="app-content">{children}</div>
    </div>
  );
}
