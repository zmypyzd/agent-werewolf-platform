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

export interface AgentInvitePublic {
  token: string;
  displayName: string | null;
  notes: string | null;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
  registeredAgentConfigId: string | null;
  status: 'pending' | 'used' | 'expired';
}

export interface GeneratedAgentInvite {
  token: string;
  expiresAt: number;
  registerUrl: string;
}

export interface AgentsPageContentProps {
  agents: UserAgentConfigPublic[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  deleteInFlight: boolean;
  deleteAgent: UserAgentConfigPublic | null;
  invites: AgentInvitePublic[];
  inviteLoading: boolean;
  inviteError: string | null;
  inviteBusy: boolean;
  generatedInvite: GeneratedAgentInvite | null;
  onRequestDelete: (agent: UserAgentConfigPublic) => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onCreateInvite: () => void;
  onRevokeInvite: (token: string) => void;
  onCopyInvitePrompt: (type: 'coding-agent' | 'http-agent', invite: GeneratedAgentInvite) => void;
}

export function AgentsPage() {
  const [agents, setAgents] = useState<UserAgentConfigPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const [deleteAgent, setDeleteAgent] = useState<UserAgentConfigPublic | null>(null);
  const [invites, setInvites] = useState<AgentInvitePublic[]>([]);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [generatedInvite, setGeneratedInvite] = useState<GeneratedAgentInvite | null>(null);
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

  const refreshInvites = useCallback(async () => {
    try {
      const list = await api.get<AgentInvitePublic[]>('/agents/invites');
      setInvites(list);
      setInviteError(null);
    } catch (e) {
      setInviteError(e instanceof ApiError ? e.message : 'Failed to load invites');
    } finally {
      setInviteLoading(false);
    }
  }, []);

  useEffect(() => { void refreshInvites(); }, [refreshInvites]);

  useEffect(() => {
    const hasPending = invites.some(invite => invite.status === 'pending');
    if (!generatedInvite && !hasPending) return undefined;
    const timer = setInterval(() => {
      void refresh();
      void refreshInvites();
    }, 3000);
    return () => clearInterval(timer);
  }, [generatedInvite, invites, refresh, refreshInvites]);

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

  async function createInvite() {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const invite = await api.post<GeneratedAgentInvite>('/agents/invites', {
        ttlSec: 24 * 60 * 60,
      });
      setGeneratedInvite(invite);
      await refreshInvites();
    } catch (e) {
      setInviteError(e instanceof ApiError ? e.message : 'Failed to create invite');
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvite(token: string) {
    setInviteBusy(true);
    setInviteError(null);
    try {
      await api.del(`/agents/invites/${token}`);
      if (generatedInvite?.token === token) setGeneratedInvite(null);
      await refreshInvites();
    } catch (e) {
      setInviteError(e instanceof ApiError ? e.message : 'Failed to revoke invite');
    } finally {
      setInviteBusy(false);
    }
  }

  function copyInvitePrompt(type: 'coding-agent' | 'http-agent', invite: GeneratedAgentInvite) {
    const text = type === 'coding-agent'
      ? buildCodingAgentInvitePrompt(invite)
      : buildHttpAgentInvitePrompt(invite);
    void navigator.clipboard.writeText(text);
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
        invites={invites}
        inviteLoading={inviteLoading}
        inviteError={inviteError}
        inviteBusy={inviteBusy}
        generatedInvite={generatedInvite}
        onRequestDelete={requestDelete}
        onCancelDelete={() => setDeleteAgent(null)}
        onConfirmDelete={confirmDelete}
        onCreateInvite={() => void createInvite()}
        onRevokeInvite={token => void revokeInvite(token)}
        onCopyInvitePrompt={copyInvitePrompt}
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
  invites,
  inviteLoading,
  inviteError,
  inviteBusy,
  generatedInvite,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onCreateInvite,
  onRevokeInvite,
  onCopyInvitePrompt,
}: AgentsPageContentProps) {
  const pendingInvites = invites.filter(invite => invite.status === 'pending');
  const codingInvitePrompt = generatedInvite ? buildCodingAgentInvitePrompt(generatedInvite) : null;
  const httpInvitePrompt = generatedInvite ? buildHttpAgentInvitePrompt(generatedInvite) : null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Agent Lab</h1>
          <p className="muted">Manage HTTP decision endpoints that can sit at your tables.</p>
        </div>
        <div className="page-actions">
          <button className="button-secondary" type="button" onClick={onCreateInvite} disabled={inviteBusy}>
            {inviteBusy ? 'Creating invite' : 'Invite External Agent'}
          </button>
          <Link className="button-primary" to="/agents/new">New agent</Link>
        </div>
      </div>

      {error && <div className="error alert-error" role="alert">{error}</div>}
      {inviteError && <div className="error alert-error" role="alert">{inviteError}</div>}

      {generatedInvite && (
        <section className="panel agent-invite-panel" aria-label="Generated invite">
          <div className="section-heading">
            <div>
              <h2>Invite External Agent</h2>
              <p className="muted">Copy a ready-to-use prompt into a coding agent or a plain HTTP agent.</p>
            </div>
            <span className="status-chip">24h token</span>
          </div>
          <div className="agent-invite-url"><code>{generatedInvite.registerUrl}</code></div>
          <div className="agent-invite-prompt-grid">
            <article className="agent-invite-prompt">
              <div className="agent-invite-prompt-header">
                <h3>Coding Agent Prompt</h3>
                <button
                  className="button-primary"
                  type="button"
                  onClick={() => onCopyInvitePrompt('coding-agent', generatedInvite)}
                >
                  Copy for Coding Agent
                </button>
              </div>
              <pre>{codingInvitePrompt}</pre>
            </article>
            <article className="agent-invite-prompt">
              <div className="agent-invite-prompt-header">
                <h3>HTTP Agent Prompt</h3>
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => onCopyInvitePrompt('http-agent', generatedInvite)}
                >
                  Copy for HTTP Agent
                </button>
              </div>
              <pre>{httpInvitePrompt}</pre>
            </article>
          </div>
        </section>
      )}

      <section className="panel agent-lab-panel" aria-label="Configured agents">
        <div className="section-heading">
          <div>
            <h2>My Agents</h2>
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

      <section className="panel agent-lab-panel" aria-label="Pending invites">
        <div className="section-heading">
          <div>
            <h2>Pending Invites</h2>
            <p className="muted">Unused registration tokens for external agents.</p>
          </div>
          <span className="status-chip">{pendingInvites.length} pending</span>
        </div>

        {inviteLoading && (
          <div className="empty-state" role="status">
            Loading invites
          </div>
        )}

        {!inviteLoading && pendingInvites.length === 0 && (
          <div className="empty-state">
            No pending invites.
          </div>
        )}

        {!inviteLoading && pendingInvites.length > 0 && (
          <div className="agent-config-list">
            {pendingInvites.map(invite => (
              <article className="agent-card agent-config-card" key={invite.token}>
                <div className="agent-card-header">
                  <div>
                    <h3>{invite.displayName ?? 'External agent invite'}</h3>
                    <p className="muted">{invite.notes ?? 'No notes'}</p>
                  </div>
                  <span className="status-chip">Pending</span>
                </div>
                <dl className="agent-config-metrics">
                  <div>
                    <dt>Token</dt>
                    <dd><code>{invite.token}</code></dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>{formatInviteExpiry(invite.expiresAt)}</dd>
                  </div>
                </dl>
                <div className="agent-card-actions">
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => onRevokeInvite(invite.token)}
                    disabled={inviteBusy}
                  >
                    Revoke
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

function formatInviteExpiry(expiresAt: number): string {
  return new Date(expiresAt).toLocaleString();
}

export function buildCodingAgentInvitePrompt(invite: Pick<GeneratedAgentInvite, 'token' | 'registerUrl'>): string {
  return `You are being invited to Agent Poker as an external coding agent.

Goal: create a small local HTTP server that receives poker decision requests, then register that server as an Agent Config.

Invite token: ${invite.token}
Register URL: ${invite.registerUrl}

1. Create a local HTTP server with one POST endpoint, for example http://localhost:8080/decide.
2. For every decision request, return JSON with the same requestId and agentId plus an action:

{
  "requestId": "from-request",
  "agentId": "from-request",
  "actionType": "fold"
}

3. Register yourself with Agent Poker:

curl -X POST ${invite.registerUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "displayName": "CodingAgent",
    "endpointUrl": "http://localhost:8080/decide",
    "timeoutMs": 5000
  }'

After registration, the user will see you in Agent Lab and can seat you at any eligible table.`;
}

export function buildHttpAgentInvitePrompt(invite: Pick<GeneratedAgentInvite, 'token' | 'registerUrl'>): string {
  return `You are being invited to Agent Poker as an external HTTP agent.

Your HTTP decision endpoint will receive POST requests with poker state and legal actions. Return a JSON decision before timeout.

Invite token: ${invite.token}

Register your endpoint:

curl -X POST ${invite.registerUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "displayName": "MyAgent",
    "endpointUrl": "https://your-agent.example/decide",
    "authHeaderName": "Authorization",
    "authHeaderValue": "Bearer optional-secret",
    "timeoutMs": 5000
  }'

Your HTTP decision endpoint response shape:

{
  "requestId": "from-request",
  "agentId": "from-request",
  "actionType": "fold",
  "amount": 0
}

Use actionType "fold", "check", "call", "bet", "raise", or "all-in". Include amount only when the chosen legal action needs chips.`;
}
