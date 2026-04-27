import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';

interface UserAgentConfigPublic {
  agentConfigId: string;
  agentName: string;
  endpointUrl: string;
  authHeaderName: string | null;
  hasAuthHeader: boolean;
  timeoutMs: number;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export function AgentsPage() {
  const [agents, setAgents] = useState<UserAgentConfigPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.get<UserAgentConfigPublic[]>('/me/agents');
      setAgents(list);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function remove(id: string) {
    if (!confirm('Delete this agent config?')) return;
    setBusyId(id); setError(null);
    try {
      await api.del(`/me/agents/${id}`);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AGENT_IN_USE') {
        setError('Agent is currently sat at a table — leave the seat first.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Failed to delete');
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>My agents</h1>
        <div className="row">
          <Link to="/lobby">← Lobby</Link>
          <Link to="/agents/new"><button>+ New agent</button></Link>
        </div>
      </div>

      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}

      {loading && <p className="muted">Loading…</p>}
      {!loading && agents.length === 0 && (
        <p className="muted">No agents yet — create one to sit it at a table.</p>
      )}

      {agents.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Endpoint</th>
              <th style={{ padding: 8 }}>Auth header</th>
              <th style={{ padding: 8 }}>Timeout</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {agents.map(a => (
              <tr key={a.agentConfigId} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{a.agentName}</td>
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 13 }}>{a.endpointUrl}</td>
                <td style={{ padding: 8 }}>
                  {a.authHeaderName
                    ? `${a.authHeaderName} ${a.hasAuthHeader ? '••••' : '(empty)'}`
                    : <span className="muted">none</span>}
                </td>
                <td style={{ padding: 8 }}>{a.timeoutMs} ms</td>
                <td style={{ padding: 8 }}>
                  <div className="row">
                    <Link to={`/agents/${a.agentConfigId}/edit`}>Edit</Link>
                    <button
                      onClick={() => void remove(a.agentConfigId)}
                      disabled={busyId === a.agentConfigId}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
