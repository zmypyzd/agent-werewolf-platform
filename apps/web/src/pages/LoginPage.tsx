import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthPanel } from '../components/AuthPanel.js';
import { signIn, useSession } from '../lib/auth.js';
import { mintAndCopyInvite, type InviteAgentKind } from '../components/InvitePopover.js';
import { useClipboardToast } from '../components/ClipboardToast.js';

function readPendingInvite(search: string): InviteAgentKind | null {
  const value = new URLSearchParams(search).get('pendingInvite');
  return value === 'coding' || value === 'http' ? value : null;
}

export interface LoginPageContentProps {
  email: string;
  password: string;
  error: string | null;
  submitting: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function LoginPage() {
  const { user } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useClipboardToast();
  // Guards against re-running the pendingInvite handler if React re-renders
  // before the navigate() below unmounts this component.
  const pendingHandledRef = useRef(false);

  // Already-logged-in visitors with ?pendingInvite=... finish the invite-and-
  // copy flow here too — without this branch, hitting /login while already
  // signed in would Navigate away before the invite ever mints.
  useEffect(() => {
    if (!user || pendingHandledRef.current) return;
    const pending = readPendingInvite(location.search);
    if (!pending) return;
    pendingHandledRef.current = true;
    const next = new URLSearchParams(location.search).get('next') ?? '/';
    void (async () => {
      try {
        await mintAndCopyInvite(pending, showToast);
      } catch {
        /* toast already shown by mintAndCopyInvite on failure */
      }
      navigate(next, { replace: true });
    })();
  }, [user, location.search, navigate, showToast]);

  if (user && !readPendingInvite(location.search)) {
    const next = new URLSearchParams(location.search).get('next') ?? '/';
    return <Navigate to={next} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signIn(email, password);
    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    const pending = readPendingInvite(location.search);
    const next = new URLSearchParams(location.search).get('next') ?? '/';
    if (pending) {
      try {
        await mintAndCopyInvite(pending, showToast);
      } catch {
        /* toast shown by mintAndCopyInvite */
      }
    }
    navigate(next, { replace: true });
  }

  return (
    <LoginPageContent
      email={email}
      password={password}
      error={error}
      submitting={submitting}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={onSubmit}
    />
  );
}

export function LoginPageContent({
  email,
  password,
  error,
  submitting,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: LoginPageContentProps) {
  return (
    <AuthPanel
      ariaLabel="Sign in"
      title="Log in"
      subtitle="Continue to your tables and agent lab."
      footer={<>No account? <Link to="/register">Register</Link></>}
    >
      <form className="auth-form" onSubmit={onSubmit}>
        <label>
          Email
          <input
            className="auth-input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={e => onEmailChange(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            className="auth-input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => onPasswordChange(e.target.value)}
          />
        </label>
        {error ? <div className="error alert-error" role="alert">{error}</div> : null}
        <button className="auth-submit button-primary" type="submit" disabled={submitting}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </AuthPanel>
  );
}
