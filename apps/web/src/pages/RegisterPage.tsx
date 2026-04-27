import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api.js';
import { useAuth } from '../auth/AuthContext.js';

export function RegisterPage() {
  const { user, register } = useAuth();
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
    try {
      await register(email, password, displayName);
      const next = new URLSearchParams(location.search).get('next') ?? '/lobby';
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <h1>Register</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email}
                 onChange={e => setEmail(e.target.value)} />
        </label>
        <label>
          Display name
          <input type="text" autoComplete="username" required minLength={1} maxLength={40} value={displayName}
                 onChange={e => setDisplayName(e.target.value)} />
        </label>
        <label>
          Password (min 8 chars)
          <input type="password" autoComplete="new-password" required minLength={8} value={password}
                 onChange={e => setPassword(e.target.value)} />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="muted">Have an account? <Link to="/login">Log in</Link></p>
    </div>
  );
}
