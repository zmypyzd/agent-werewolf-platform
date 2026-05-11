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
  // Wire field is `tokenHash` (sha256). The raw token is emitted by the
  // server exactly once — at creation — and never again, so list/render
  // paths only ever see the hash. Use the freshly-generated invite's
  // `token` for actions that need the raw value (e.g. copying into a
  // prompt for an external agent); use `tokenHash` for revoke and as a
  // React key.
  tokenHash: string;
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

// Poker and werewolf use different request/response shapes on the wire (see
// docs/werewolf-http-agent-guide.md). Generated invite copy is parameterised by
// game type so the prompt the user pastes into a coding agent matches the seat
// they intend to fill — pasting the poker scaffold for a werewolf seat is a
// silent failure (the werewolf orchestrator falls back to validActions[0],
// which is the empty-string speak template).
export type AgentInviteGameType = 'poker' | 'werewolf';

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
  onRevokeInvite: (tokenHash: string) => void;
  onCopyInvitePrompt: (type: 'coding-agent' | 'http-agent', invite: GeneratedAgentInvite) => void;
  gameType: AgentInviteGameType;
  onGameTypeChange: (gameType: AgentInviteGameType) => void;
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
  const [gameType, setGameType] = useState<AgentInviteGameType>('poker');
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

  // Listed invites only carry the sha256 hash — the raw token is emitted
  // exactly once at creation. Routed to the by-hash endpoint that the API
  // exposes specifically for this case. The freshly-generated invite card
  // (which still has the raw token in scope) calls revokeGeneratedInvite
  // below instead.
  async function revokeInviteByHash(tokenHash: string) {
    setInviteBusy(true);
    setInviteError(null);
    try {
      await api.del(`/agents/invites/by-hash/${tokenHash}`);
      await refreshInvites();
    } catch (e) {
      setInviteError(e instanceof ApiError ? e.message : 'Failed to revoke invite');
    } finally {
      setInviteBusy(false);
    }
  }

  function copyInvitePrompt(type: 'coding-agent' | 'http-agent', invite: GeneratedAgentInvite) {
    const text = type === 'coding-agent'
      ? buildCodingAgentInvitePrompt(invite, gameType)
      : buildHttpAgentInvitePrompt(invite, gameType);
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
        onRevokeInvite={tokenHash => void revokeInviteByHash(tokenHash)}
        onCopyInvitePrompt={copyInvitePrompt}
        gameType={gameType}
        onGameTypeChange={setGameType}
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
  gameType,
  onGameTypeChange,
}: AgentsPageContentProps) {
  const pendingInvites = invites.filter(invite => invite.status === 'pending');
  const codingInvitePrompt = generatedInvite
    ? buildCodingAgentInvitePrompt(generatedInvite, gameType)
    : null;
  const httpInvitePrompt = generatedInvite
    ? buildHttpAgentInvitePrompt(generatedInvite, gameType)
    : null;

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
          <div
            className="agent-invite-game-type"
            role="radiogroup"
            aria-label="Game protocol"
          >
            <span className="agent-invite-game-type-label">Game</span>
            <div className="agent-invite-game-type-options">
              <button
                type="button"
                role="radio"
                aria-checked={gameType === 'poker'}
                className={
                  gameType === 'poker'
                    ? 'button-primary agent-invite-game-type-option'
                    : 'button-secondary agent-invite-game-type-option'
                }
                onClick={() => onGameTypeChange('poker')}
              >
                Poker
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={gameType === 'werewolf'}
                className={
                  gameType === 'werewolf'
                    ? 'button-primary agent-invite-game-type-option'
                    : 'button-secondary agent-invite-game-type-option'
                }
                onClick={() => onGameTypeChange('werewolf')}
              >
                Werewolf
              </button>
            </div>
            <p className="muted agent-invite-game-type-hint">
              Poker and werewolf use different request fields and action shapes.
              Pick the protocol that matches the seat you intend to fill.
            </p>
          </div>
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
              <article className="agent-card agent-config-card" key={invite.tokenHash}>
                <div className="agent-card-header">
                  <div>
                    <h3>{invite.displayName ?? 'External agent invite'}</h3>
                    <p className="muted">{invite.notes ?? 'No notes'}</p>
                  </div>
                  <span className="status-chip">Pending</span>
                </div>
                <dl className="agent-config-metrics">
                  <div>
                    <dt>Created</dt>
                    <dd>{formatInviteExpiry(invite.createdAt)}</dd>
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
                    onClick={() => onRevokeInvite(invite.tokenHash)}
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

// Derive the platform's public origin from the registerUrl baked into the
// invite — same scheme/host/port the operator uses to register, so docs
// and reference assets resolve against the same deployment (local dev,
// preview, prod). Falls back to relative paths if registerUrl is malformed.
function deriveOrigin(registerUrl: string): string {
  try {
    return new URL(registerUrl).origin;
  } catch {
    return '';
  }
}

export function buildCodingAgentInvitePrompt(
  invite: Pick<GeneratedAgentInvite, 'token' | 'registerUrl'>,
  gameType: AgentInviteGameType,
): string {
  const origin = deriveOrigin(invite.registerUrl);
  const docsUrl = `${origin}/api/v1/docs/werewolf-agent-guide`;
  if (gameType === 'werewolf') {
    return `You are being invited to Agent Poker as an external coding agent for the 9-player WEREWOLF module.

Goal: create a small local HTTP server that receives werewolf decision requests, then register that server as an Agent Config. Everything you need to do this is in this prompt — do not stop to ask the human for the API contract.

Invite token: ${invite.token}
Register URL: ${invite.registerUrl}
Full HTTP contract: ${docsUrl}            (publicly fetchable plain-text markdown)
Reference implementation: https://github.com/zmypyzd/agent-werewolf-platform/tree/main/examples/werewolf-agent

IMPORTANT: Your endpoint URL must be publicly reachable from the internet —
the platform POSTs to it from its servers. For a local agent, expose port
8080 with one of:
  - cloudflared:  cloudflared tunnel --url http://localhost:8080
  - ngrok:        ngrok http 8080
Use the public tunnel URL (https://something.trycloudflare.com / *.ngrok.app)
as endpointUrl in the registration command, NOT http://localhost:8080.

Step 1. Create a local HTTP server with one POST endpoint at /decide.
Step 2. The body is a WerewolfDecisionRequest. Candidate actions are in
        body.validActions (NOT body.legalActions — that is the poker
        contract). Each action is identified by a.type (NOT a.actionType).
Step 3. Return JSON echoing requestId and agentId, with action set
        structurally to one of body.validActions.

Inbound request shape (day-speeches example, trimmed):

{
  "requestId": "req-...",
  "gameId": "game-...",
  "agentId": "cfg-...",
  "playerId": "p3",
  "phase": "day-speeches",          // also: night-werewolf-vote | night-witch | night-seer | day-vote | hunter-shoot
  "nightNumber": 1,
  "dayNumber": 1,
  "publicState": {
    "players": [{ "id": "p1", "seatIndex": 0, "name": "...", "alive": true, "revealedRole": null }, ...],
    "history": [{ "type": "death", "day": 1, "playerId": "p2", "cause": "wolf-kill" }, ...],
    "winner": null
  },
  "privateState": {
    "selfId": "p3", "selfRole": "villager", "selfSide": "good",
    "knownAllies": [], "seerKnowledge": [], "witchView": null, "hunterCanShoot": false
  },
  "validActions": [
    { "type": "speak", "playerId": "p3", "inner": "", "performance": "", "speech": "" }
  ],
  "deadlineMs": 15000
}

Valid response (day-speeches — fill the three speak fields, NEVER return the empty skeleton):

{
  "requestId": "from-request",
  "agentId": "from-request",
  "action": {
    "type": "speak",
    "playerId": "<echo from request>",
    "inner": "private reasoning, only visible to the match decision-trace",
    "performance": "short body-language note (public)",
    "speech": "what your seat actually says out loud (public)"
  }
}

Other phases pick from validActions verbatim, e.g.
  day-vote          → { "type": "day-vote", "voterId": "<self>", "targetId": "<other-alive-player or null to abstain>" }
  night-werewolf-vote (wolves only) → { "type": "werewolf-vote", "voterId": "<self>", "targetId": "<non-wolf alive>" }
  night-seer        → { "type": "seer-divine", "targetId": "<alive non-self>" }
  night-witch       → { "type": "witch-save", "targetId": "..." } | { "type": "witch-skip-save" } | { "type": "witch-poison", "targetId": "..." } | { "type": "witch-skip-poison" }
  hunter-shoot      → { "type": "hunter-shoot", "targetId": "<alive non-self> or null to pass" }

If the action you return is not structurally one of validActions (or you time out, or your speech is empty), the orchestrator substitutes validActions[0] and your seat appears mute. Read ${docsUrl} for the full per-phase schema.

Step 4. Register yourself with Agent Poker:

curl -X POST ${invite.registerUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "displayName": "WerewolfAgent",
    "endpointUrl": "https://your-public-tunnel.example/decide",
    "timeoutMs": 15000
  }'

After registration, the user will see you in Agent Lab and can seat you in any empty werewolf seat.`;
  }
  return `You are being invited to Agent Poker as an external coding agent for the POKER module.

Goal: create a small local HTTP server that receives poker decision requests, then register that server as an Agent Config. Everything you need to do this is in this prompt — do not stop to ask the human for the API contract.

Invite token: ${invite.token}
Register URL: ${invite.registerUrl}

IMPORTANT: Your endpoint URL must be publicly reachable from the internet —
the platform POSTs to it from its servers. For a local agent, expose port
8080 with cloudflared (cloudflared tunnel --url http://localhost:8080) or
ngrok (ngrok http 8080). Use the public tunnel URL as endpointUrl below,
NOT http://localhost:8080.

Step 1. Create a local HTTP server with one POST endpoint at /decide.

Inbound request shape (preflop example, trimmed):

{
  "requestId": "req-...",
  "handId": "hand-...",
  "tableId": "tbl-...",
  "agentId": "<your agent id>",
  "publicState": {
    "phase": "preflop",                    // also: flop | turn | river | showdown
    "players": [{ "playerId": "p1", "seatIndex": 0, "stack": 980, "status": "active", "totalBetInHand": 20, "currentRoundBet": 20 }, ...],
    "communityCards": [],                  // length 0/3/4/5
    "pots": [{ "amount": 30, "eligiblePlayerIds": ["p0","p1","p2"] }],
    "button": 0, "smallBlindIndex": 1, "bigBlindIndex": 2,
    "currentActorIndex": 3,
    "currentRoundMinBet": 20,
    "minRaiseAmount": 40,
    "allActions": [/* full action history this hand */]
  },
  "privateState": {
    "playerId": "<your seat>",
    "holeCards": [{ "rank": "A", "suit": "s" }, { "rank": "K", "suit": "d" }]
  },
  "legalActions": [
    { "type": "fold" },
    { "type": "call", "callAmount": 20 },
    { "type": "raise", "minAmount": 40, "maxAmount": 980 }
  ],
  "timeoutMs": 5000
}

Step 2. Pick one of legalActions. Note the field renaming: legalActions[i].type is the field on the request side, but your response uses actionType. Return JSON echoing requestId and agentId:

{
  "requestId": "from-request",
  "agentId": "from-request",
  "actionType": "raise",       // one of: fold | check | call | bet | raise | all-in
  "amount": 40                  // include for bet/raise/call/all-in; omit for fold/check
}

Step 3. Register yourself with Agent Poker:

curl -X POST ${invite.registerUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "displayName": "CodingAgent",
    "endpointUrl": "https://your-public-tunnel.example/decide",
    "timeoutMs": 5000
  }'

After registration, the user will see you in Agent Lab and can seat you at any eligible table.`;
}

export function buildHttpAgentInvitePrompt(
  invite: Pick<GeneratedAgentInvite, 'token' | 'registerUrl'>,
  gameType: AgentInviteGameType,
): string {
  const origin = deriveOrigin(invite.registerUrl);
  const docsUrl = `${origin}/api/v1/docs/werewolf-agent-guide`;
  if (gameType === 'werewolf') {
    return `You are being invited to Agent Poker as an external HTTP agent for the 9-player WEREWOLF module.

Your HTTP decision endpoint will receive POST requests with werewolf state
(publicState, privateState, phase, validActions) and must return a JSON decision
before timeout.

This is a DIFFERENT protocol from the poker module. Pinning the differences:
  - Candidate actions live in body.validActions (not body.legalActions).
  - Each action is identified by a.type (not a.actionType).
  - The response carries an action object (one of validActions), not an actionType string.

Invite token: ${invite.token}
Full HTTP contract (publicly fetchable plain-text): ${docsUrl}

Register your endpoint:

curl -X POST ${invite.registerUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "displayName": "MyWerewolfAgent",
    "endpointUrl": "https://your-agent.example/decide",
    "authHeaderName": "Authorization",
    "authHeaderValue": "Bearer optional-secret",
    "timeoutMs": 15000
  }'

Response shape:

{
  "requestId": "from-request",
  "agentId": "from-request",
  "action": { "type": "speak", "playerId": "...", "inner": "...", "performance": "...", "speech": "..." }
}

The action you return MUST be structurally one of body.validActions. The
orchestrator substitutes a fallback (which makes you look mute on day-speeches)
on schema mismatch, network error, or timeout. Fetch ${docsUrl} for the full
per-phase schema, request body fields, and worked end-to-end example.`;
  }
  return `You are being invited to Agent Poker as an external HTTP agent for the POKER module.

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

Inbound request shape:

{
  "requestId": "...", "handId": "...", "tableId": "...", "agentId": "...",
  "publicState": { "phase": "preflop|flop|turn|river|showdown", "players": [...], "communityCards": [...], "pots": [...], "button": N, "currentActorIndex": N, "currentRoundMinBet": N, "minRaiseAmount": N, "allActions": [...] },
  "privateState": { "playerId": "...", "holeCards": [{ "rank": "A", "suit": "s" }, { "rank": "K", "suit": "d" }] },
  "legalActions": [ { "type": "fold" }, { "type": "call", "callAmount": 20 }, { "type": "raise", "minAmount": 40, "maxAmount": 980 } ],
  "timeoutMs": 5000
}

Your HTTP decision endpoint response shape:

{
  "requestId": "from-request",
  "agentId": "from-request",
  "actionType": "fold",
  "amount": 0
}

Use actionType "fold", "check", "call", "bet", "raise", or "all-in". Include amount only when the chosen legal action needs chips. Note the request uses legalActions[i].type but your response uses actionType.`;
}
