import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';

interface UserAgentConfigPublic {
  agentConfigId: string;
  agentName: string;
  endpointUrl: string;
  authHeaderName: string | null;
  hasAuthHeader: boolean;
  timeoutMs: number;
  description: string | null;
}

export function AgentEditPage({ mode }: { mode: 'new' | 'edit' }) {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();

  const [agentName, setAgentName] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [authHeaderName, setAuthHeaderName] = useState('');
  const [authHeaderValue, setAuthHeaderValue] = useState('');
  const [clearAuthHeader, setClearAuthHeader] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [description, setDescription] = useState('');

  const [loading, setLoading] = useState(mode === 'edit');
  const [hasAuthHeader, setHasAuthHeader] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode !== 'edit' || !agentId) return;
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await api.get<UserAgentConfigPublic>(`/me/agents/${agentId}`);
        if (cancelled) return;
        setAgentName(cfg.agentName);
        setEndpointUrl(cfg.endpointUrl);
        setAuthHeaderName(cfg.authHeaderName ?? '');
        setHasAuthHeader(cfg.hasAuthHeader);
        setTimeoutMs(cfg.timeoutMs);
        setDescription(cfg.description ?? '');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Failed to load agent');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, agentId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'new') {
        await api.post('/me/agents', {
          agentName,
          endpointUrl,
          authHeaderName: authHeaderName.trim() === '' ? null : authHeaderName.trim(),
          authHeaderValue: authHeaderValue.trim() === '' ? null : authHeaderValue,
          timeoutMs,
          description: description.trim() === '' ? null : description.trim(),
        });
      } else if (agentId) {
        const patch: Record<string, unknown> = {
          agentName,
          endpointUrl,
          authHeaderName: authHeaderName.trim() === '' ? null : authHeaderName.trim(),
          timeoutMs,
          description: description.trim() === '' ? null : description.trim(),
        };
        // authHeaderValue is write-only:
        //   - blank input + clear toggle off → leave existing value untouched
        //   - typed → replace with the typed value
        //   - blank + clear toggle on    → null it out
        if (clearAuthHeader) {
          patch['authHeaderValue'] = null;
        } else if (authHeaderValue !== '') {
          patch['authHeaderValue'] = authHeaderValue;
        }
        await api.patch(`/me/agents/${agentId}`, patch);
      }
      navigate('/agents');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="page">Loading agent…</div>;

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{mode === 'new' ? 'New agent' : `Edit agent`}</h1>
        <Link to="/agents">← Agents</Link>
      </div>

      <form onSubmit={onSubmit} style={{ marginTop: 16, maxWidth: 480 }}>
        <label>
          Agent name
          <input
            value={agentName}
            onChange={e => setAgentName(e.target.value)}
            required minLength={1} maxLength={40}
          />
        </label>
        <label>
          Endpoint URL
          <input
            type="url"
            value={endpointUrl}
            onChange={e => setEndpointUrl(e.target.value)}
            required
            placeholder="https://example.test/decide"
          />
          <span className="muted">https:// required (http:// allowed for localhost / 127.0.0.1)</span>
        </label>
        <label>
          Auth header name (optional)
          <input
            value={authHeaderName}
            onChange={e => setAuthHeaderName(e.target.value)}
            placeholder="Authorization"
            maxLength={80}
          />
        </label>
        <label>
          Auth header value
          <input
            type="password"
            value={authHeaderValue}
            onChange={e => setAuthHeaderValue(e.target.value)}
            placeholder={mode === 'edit' && hasAuthHeader ? 'Leave blank to keep current' : 'Bearer …'}
            maxLength={2048}
          />
          {mode === 'edit' && hasAuthHeader && (
            <label className="row" style={{ flexDirection: 'row', marginTop: 4 }}>
              <input
                type="checkbox"
                checked={clearAuthHeader}
                onChange={e => setClearAuthHeader(e.target.checked)}
              />
              <span className="muted">Clear current value (set header to none)</span>
            </label>
          )}
        </label>
        <label>
          Timeout (ms)
          <input
            type="number"
            min={100} max={30000}
            value={timeoutMs}
            onChange={e => setTimeoutMs(Number(e.target.value))}
            required
          />
        </label>
        <label>
          Description (optional)
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </label>

        {error && <div className="error">{error}</div>}

        <div className="row">
          <button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : (mode === 'new' ? 'Create' : 'Save')}
          </button>
          <Link to="/agents">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
