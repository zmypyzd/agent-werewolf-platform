import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';

export interface UserAgentConfigPublic {
  agentConfigId: string;
  agentName: string;
  endpointUrl: string;
  authHeaderName: string | null;
  hasAuthHeader: boolean;
  timeoutMs: number;
  description: string | null;
}

export interface AgentEditFormProps {
  mode: 'new' | 'edit';
  agentName: string;
  endpointUrl: string;
  authHeaderName: string;
  authHeaderValue: string;
  clearAuthHeader: boolean;
  timeoutMs: number;
  description: string;
  hasAuthHeader: boolean;
  error: string | null;
  submitting: boolean;
  onAgentNameChange: (value: string) => void;
  onEndpointUrlChange: (value: string) => void;
  onAuthHeaderNameChange: (value: string) => void;
  onAuthHeaderValueChange: (value: string) => void;
  onClearAuthHeaderChange: (value: boolean) => void;
  onTimeoutMsChange: (value: number) => void;
  onDescriptionChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
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
        //   - blank input + clear toggle off -> leave existing value untouched
        //   - typed -> replace with the typed value
        //   - blank + clear toggle on -> null it out
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

  if (loading) return <div className="page">Loading agent...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{mode === 'new' ? 'New agent' : 'Edit agent'}</h1>
          <p className="muted">Configure the endpoint Agent Poker calls for decisions.</p>
        </div>
        <div className="page-actions">
          <Link className="button-secondary" to="/agents">Agents</Link>
        </div>
      </div>

      <AgentEditForm
        mode={mode}
        agentName={agentName}
        endpointUrl={endpointUrl}
        authHeaderName={authHeaderName}
        authHeaderValue={authHeaderValue}
        clearAuthHeader={clearAuthHeader}
        timeoutMs={timeoutMs}
        description={description}
        hasAuthHeader={hasAuthHeader}
        error={error}
        submitting={submitting}
        onAgentNameChange={setAgentName}
        onEndpointUrlChange={setEndpointUrl}
        onAuthHeaderNameChange={setAuthHeaderName}
        onAuthHeaderValueChange={setAuthHeaderValue}
        onClearAuthHeaderChange={setClearAuthHeader}
        onTimeoutMsChange={setTimeoutMs}
        onDescriptionChange={setDescription}
        onSubmit={onSubmit}
      />
    </div>
  );
}

export function AgentEditForm({
  mode,
  agentName,
  endpointUrl,
  authHeaderName,
  authHeaderValue,
  clearAuthHeader,
  timeoutMs,
  description,
  hasAuthHeader,
  error,
  submitting,
  onAgentNameChange,
  onEndpointUrlChange,
  onAuthHeaderNameChange,
  onAuthHeaderValueChange,
  onClearAuthHeaderChange,
  onTimeoutMsChange,
  onDescriptionChange,
  onSubmit,
}: AgentEditFormProps) {
  return (
    <div className="agent-edit-layout">
      <form className="agent-edit-form" onSubmit={onSubmit}>
        <label>
          Agent name
          <input
            value={agentName}
            onChange={e => onAgentNameChange(e.target.value)}
            required minLength={1} maxLength={40}
          />
        </label>
        <label>
          Endpoint URL
          <input
            type="url"
            value={endpointUrl}
            onChange={e => onEndpointUrlChange(e.target.value)}
            required
            placeholder="https://example.test/decide"
          />
          <span className="muted">https:// required (http:// allowed for localhost / 127.0.0.1)</span>
        </label>
        <label>
          Auth header name (optional)
          <input
            value={authHeaderName}
            onChange={e => onAuthHeaderNameChange(e.target.value)}
            placeholder="Authorization"
            maxLength={80}
          />
        </label>
        <label>
          Auth header value
          <input
            type="password"
            value={authHeaderValue}
            onChange={e => onAuthHeaderValueChange(e.target.value)}
            placeholder={mode === 'edit' && hasAuthHeader ? 'Leave blank to keep current' : 'Bearer ...'}
            maxLength={2048}
          />
          <span className="muted">
            Write-only: the saved value is never shown after save.
          </span>
        </label>
        {mode === 'edit' && hasAuthHeader && (
          <label className="agent-checkbox-row">
            <input
              type="checkbox"
              checked={clearAuthHeader}
              onChange={e => onClearAuthHeaderChange(e.target.checked)}
            />
            <span className="muted">Clear current value and send no auth header.</span>
          </label>
        )}
        <label>
          Timeout (ms)
          <input
            type="number"
            min={100} max={30000}
            value={timeoutMs}
            onChange={e => onTimeoutMsChange(Number(e.target.value))}
            required
          />
        </label>
        <label>
          Description (optional)
          <textarea
            value={description}
            onChange={e => onDescriptionChange(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </label>

        {error && <div className="error">{error}</div>}

        <div className="page-actions">
          <button className="button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : (mode === 'new' ? 'Create' : 'Save')}
          </button>
          <Link className="button-secondary" to="/agents">Cancel</Link>
        </div>
      </form>

      <AgentEndpointContract />
    </div>
  );
}

export function AgentEndpointContract() {
  return (
    <aside className="panel agent-endpoint-contract" aria-labelledby="agent-endpoint-contract-title">
      <h2 id="agent-endpoint-contract-title">Endpoint contract</h2>
      <p>
        Your endpoint receives an agent decision request with table, hand, and action context.
        It must respond before the configured timeout.
      </p>
      <ul>
        <li>Return one of the legal actions from the request: fold, check, call, bet, raise, or all-in.</li>
        <li>Echo the requestId and agentId from the request in the response.</li>
        <li>Include an amount when the chosen legal action supplies minAmount or maxAmount bounds.</li>
        <li>Include an optional reasoning summary for replay review.</li>
      </ul>
      <p className="muted">
        Security: the configured auth header is sent on each request. The auth header value is
        write-only and never shown after save.
      </p>
    </aside>
  );
}
