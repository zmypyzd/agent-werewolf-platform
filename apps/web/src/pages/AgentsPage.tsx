import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ApiError, api } from '../lib/api.js';

export interface UserAgentConfigPublic {
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

export interface AgentsPageContentProps {
  agents: UserAgentConfigPublic[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  deleteInFlight: boolean;
  deleteAgent: UserAgentConfigPublic | null;
  onRequestDelete: (agent: UserAgentConfigPublic) => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

export function AgentsPage() {
  const [agents, setAgents] = useState<UserAgentConfigPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const [deleteAgent, setDeleteAgent] = useState<UserAgentConfigPublic | null>(null);
  const deleteInFlightRef = useRef(false);

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
    if (deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    setDeleteInFlight(true);
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
      setDeleteInFlight(false);
      deleteInFlightRef.current = false;
    }
  }

  function requestDelete(agent: UserAgentConfigPublic) {
    if (deleteInFlightRef.current) return;
    setDeleteAgent(agent);
  }

  function confirmDelete() {
    if (!deleteAgent || deleteInFlightRef.current) return;
    const id = deleteAgent.agentConfigId;
    setDeleteAgent(null);
    void remove(id);
  }

  return (
    <div className="page">
      <AgentsPageContent
        agents={agents}
        loading={loading}
        error={error}
        busyId={busyId}
        deleteInFlight={deleteInFlight}
        deleteAgent={deleteAgent}
        onRequestDelete={requestDelete}
        onCancelDelete={() => setDeleteAgent(null)}
        onConfirmDelete={confirmDelete}
      />
    </div>
  );
}

export function AgentsPageContent({
  agents,
  loading,
  error,
  busyId,
  deleteInFlight,
  deleteAgent,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: AgentsPageContentProps) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Agent Lab</h1>
          <p className="muted">Manage HTTP decision endpoints that can sit at your tables.</p>
        </div>
        <div className="page-actions">
          <Link className="button-secondary" to="/lobby">Lobby</Link>
          <Link className="button-primary" to="/agents/new">New agent</Link>
        </div>
      </div>

      {error && <div className="error alert-error" role="alert">{error}</div>}

      <section className="panel agent-lab-panel" aria-label="Configured agents">
        <div className="section-heading">
          <div>
            <h2>Configured agents</h2>
            <p className="muted">Each saved agent points to one endpoint and optional auth header.</p>
          </div>
          <span className="status-chip">{agents.length} saved</span>
        </div>

        {loading && (
          <div className="empty-state" role="status">
            Loading agents
          </div>
        )}

        {!loading && agents.length === 0 && (
          <div className="empty-state agent-empty-state">
            <div>
              <h3>No agents yet.</h3>
              <p>Save an endpoint before seating an agent at a table.</p>
            </div>
            <ul className="agent-empty-checklist" aria-label="Minimum agent configuration">
              <li>Endpoint URL</li>
              <li>Timeout</li>
              <li>Auth header</li>
            </ul>
            <Link className="button-primary" to="/agents/new">New agent</Link>
          </div>
        )}

        {!loading && agents.length > 0 && (
          <div className="agent-config-list">
            {agents.map(agent => (
              <article className="agent-card agent-config-card" key={agent.agentConfigId}>
                <div className="agent-card-header">
                  <div>
                    <h3>{agent.agentName}</h3>
                    <p className="muted">{agent.description ?? 'No description'}</p>
                  </div>
                  <span className="status-chip">{formatAuthStatus(agent)}</span>
                </div>

                <dl className="agent-config-metrics">
                  <div>
                    <dt>Endpoint</dt>
                    <dd><code>{agent.endpointUrl}</code></dd>
                  </div>
                  <div>
                    <dt>Timeout</dt>
                    <dd>{agent.timeoutMs} ms</dd>
                  </div>
                  <div>
                    <dt>Auth header</dt>
                    <dd>{formatAuthDetails(agent)}</dd>
                  </div>
                </dl>

                <div className="agent-card-actions">
                  <Link className="button-secondary" to={`/agents/${agent.agentConfigId}/edit`}>
                    Edit
                  </Link>
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => onRequestDelete(agent)}
                    disabled={deleteInFlight}
                  >
                    {busyId === agent.agentConfigId ? 'Deleting' : 'Delete'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteAgent !== null}
        title={deleteAgent ? `Delete ${deleteAgent.agentName}?` : 'Delete agent?'}
        message="This removes the saved endpoint and auth header configuration. Agents already seated at a table must leave before deletion."
        confirmLabel="Delete agent"
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />
    </>
  );
}

function formatAuthStatus(agent: UserAgentConfigPublic): string {
  if (agent.authHeaderName && agent.hasAuthHeader) return 'Auth configured';
  if (agent.authHeaderName) return 'Auth name only';
  return 'No auth header';
}

function formatAuthDetails(agent: UserAgentConfigPublic): string {
  if (!agent.authHeaderName) return 'No auth header';
  if (agent.hasAuthHeader) return `${agent.authHeaderName} header set`;
  return `${agent.authHeaderName} has no stored value`;
}
