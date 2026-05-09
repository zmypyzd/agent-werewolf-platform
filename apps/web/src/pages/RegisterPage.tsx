import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthPanel } from '../components/AuthPanel.js';
import { signUp, useSession } from '../lib/auth.js';

export interface RegisterPageContentProps {
  email: string;
  displayName: string;
  password: string;
  error: string | null;
  submitting: boolean;
  onEmailChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function RegisterPage() {
  const { user } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  if (user) {
    const next = new URLSearchParams(location.search).get('next') ?? '/lobby';
    return <Navigate to={next} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signUp(email, password, { displayName });
    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    const next = new URLSearchParams(location.search).get('next') ?? '/lobby';
    navigate(next, { replace: true });
  }

  return (
    <RegisterPageContent
      email={email}
      displayName={displayName}
      password={password}
      error={error}
      submitting={submitting}
      onEmailChange={setEmail}
      onDisplayNameChange={setDisplayName}
      onPasswordChange={setPassword}
      onSubmit={onSubmit}
    />
  );
}

export function RegisterPageContent({
  email,
  displayName,
  password,
  error,
  submitting,
  onEmailChange,
  onDisplayNameChange,
  onPasswordChange,
  onSubmit,
}: RegisterPageContentProps) {
  return (
    <AuthPanel
      ariaLabel="Create account"
      title="Register"
      subtitle="Create a player profile for table sessions."
      footer={<>Have an account? <Link to="/login">Log in</Link></>}
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
          Display name
          <input
            className="auth-input"
            type="text"
            autoComplete="username"
            required
            minLength={1}
            maxLength={40}
            value={displayName}
            onChange={e => onDisplayNameChange(e.target.value)}
          />
        </label>
        <label>
          Password (min 8 chars)
          <input
            className="auth-input"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={e => onPasswordChange(e.target.value)}
          />
        </label>
        {error ? <div className="error alert-error" role="alert">{error}</div> : null}
        <button className="auth-submit button-primary" type="submit" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create account'}
        </button>
      </form>
    </AuthPanel>
  );
}
