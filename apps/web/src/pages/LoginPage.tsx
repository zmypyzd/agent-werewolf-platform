import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthPanel } from '../components/AuthPanel.js';
import { signIn, useSession } from '../lib/auth.js';

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

  if (user) {
    const next = new URLSearchParams(location.search).get('next') ?? '/werewolf';
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
    const next = new URLSearchParams(location.search).get('next') ?? '/werewolf';
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
