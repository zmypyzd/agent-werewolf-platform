import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import {
  AgentConnectionRegistry,
  WerewolfWsAgentAdapter,
} from '@agent-poker/agent-runtime';
import {
  hashAgentToken,
  type AgentRecord,
  type IAgentStore,
  type NewAgent,
  type CreateAgentResult,
  type PatchAgent,
} from '@agent-poker/persistence';
import { NotFoundError, type WerewolfDecisionRequest } from '@agent-poker/shared';
import type {
  AgentWsClientMessage,
  AgentWsServerMessage,
} from '@agent-poker/agent-protocol';
import { buildServer } from '../server.js';

// ─── End-to-end test for the reverse-WS transport ───────────────────────────
// Boots a real Fastify server, opens a real WS upgrade with a Bearer
// token, and exercises the round-trip from
//   WerewolfWsAgentAdapter.requestDecision()
// through the orchestrator-side AgentConnectionRegistry, across the
// /agents/connect route, into a fake "agent process" that responds.
//
// Uses an in-memory IAgentStore so no Supabase is required. Mirrors the
// auth path of werewolf-mailbox.ts but over WS.

class InMemoryAgentStore implements IAgentStore {
  private agents = new Map<string, AgentRecord>();
  private byTokenHash = new Map<string, AgentRecord>();

  add(agent: AgentRecord, tokenHash: string | null): void {
    this.agents.set(agent.id, agent);
    if (tokenHash) this.byTokenHash.set(tokenHash, agent);
  }

  async findByTokenHash(tokenHash: string): Promise<AgentRecord | null> {
    return this.byTokenHash.get(tokenHash) ?? null;
  }

  async getById(agentId: string): Promise<AgentRecord | null> {
    return this.agents.get(agentId) ?? null;
  }
  async list(): Promise<AgentRecord[]> {
    return Array.from(this.agents.values());
  }
  async get(_ownerId: string, agentId: string): Promise<AgentRecord | null> {
    return this.agents.get(agentId) ?? null;
  }
  async create(_input: NewAgent): Promise<CreateAgentResult> {
    throw new Error('not implemented in fake');
  }
  async update(_o: string, _a: string, _p: PatchAgent): Promise<AgentRecord> {
    throw new Error('not implemented in fake');
  }
  async rotateToken(): Promise<{ agent: AgentRecord; rawToken: string }> {
    throw new Error('not implemented in fake');
  }
  async delete(_o: string, agentId: string): Promise<void> {
    if (!this.agents.delete(agentId)) throw new NotFoundError('Agent', agentId);
  }
}

const RAW_TOKEN = 'ag_e2e_raw_token_for_test_only_xxxxxx';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';

function makeWsAgentRecord(): AgentRecord {
  return {
    id: AGENT_ID,
    ownerId: 'owner-1',
    name: 'WsTestAgent',
    description: null,
    protocol: 'ws',
    callbackUrl: null,
    authHeaderName: null,
    authHeaderValue: null,
    timeoutMs: 30_000,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function buildRequest(): WerewolfDecisionRequest {
  return {
    requestId: 'req-e2e-1',
    gameId: 'game-e2e',
    agentId: AGENT_ID,
    playerId: 'p1',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    publicState: {
      gameId: 'game-e2e',
      phase: 'night-werewolf-vote',
      nightNumber: 1,
      dayNumber: 0,
      players: [],
      history: [],
      winner: null,
    },
    privateState: {
      selfId: 'p1',
      selfRole: 'werewolf',
      selfSide: 'werewolf',
      knownAllies: [],
      seerKnowledge: [],
      witchView: null,
      hunterCanShoot: false,
    },
    validActions: [{ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' }],
    deadlineMs: 5_000,
  };
}

// ─── fixture ────────────────────────────────────────────────────────────────

let app: FastifyInstance;
let wsBaseUrl: string;
let agentRegistry: AgentConnectionRegistry;
let agentStore: InMemoryAgentStore;

beforeEach(async () => {
  agentRegistry = new AgentConnectionRegistry();
  agentStore = new InMemoryAgentStore();
  agentStore.add(makeWsAgentRecord(), hashAgentToken(RAW_TOKEN));

  app = buildServer({
    werewolfAgentStore: agentStore,
    agentRegistry,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  wsBaseUrl = `ws://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await app.close();
});

// Open a WS to /agents/connect and wait for the server's hello frame so
// the test only proceeds once the connection has been registered.
async function connectAgent(token: string): Promise<{
  ws: WebSocket;
  hello: AgentWsServerMessage;
  serverFrames: AgentWsServerMessage[];
}> {
  return await new Promise((resolve, reject) => {
    const serverFrames: AgentWsServerMessage[] = [];
    const ws = new WebSocket(`${wsBaseUrl}/api/v1/agents/connect`, {
      headers: { authorization: `Bearer ${token}` },
    });
    let helloSeen = false;

    ws.on('message', (raw) => {
      let msg: AgentWsServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as AgentWsServerMessage;
      } catch {
        return;
      }
      serverFrames.push(msg);
      if (!helloSeen && msg.type === 'hello') {
        helloSeen = true;
        resolve({ ws, hello: msg, serverFrames });
      }
    });
    ws.on('error', (err) => {
      if (!helloSeen) reject(err);
    });
    // Reject if the upgrade is rejected at the HTTP layer.
    ws.on('unexpected-response', (_req, res) => {
      reject(new Error(`upgrade failed with status ${res.statusCode}`));
    });
  });
}

// Wait until predicate returns true on the array of received server
// frames; resolves with the matching frame. Used to wait for `decide`
// to arrive without introducing arbitrary sleeps.
async function waitForFrame<T extends AgentWsServerMessage['type']>(
  serverFrames: AgentWsServerMessage[],
  type: T,
  timeoutMs = 2_000,
): Promise<Extract<AgentWsServerMessage, { type: T }>> {
  const start = Date.now();
  // Active poll: cheap because the agent-side loop is single-threaded
  // and frames arrive within ms over loopback.
  while (Date.now() - start < timeoutMs) {
    const frame = serverFrames.find((f): f is Extract<AgentWsServerMessage, { type: T }> => f.type === type);
    if (frame) return frame;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timeout waiting for ${type} frame`);
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('agents-ws E2E (reverse-WebSocket transport)', () => {
  it('rejects upgrade with 401 when Bearer token is missing', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${wsBaseUrl}/api/v1/agents/connect`);
      ws.on('open', () => {
        reject(new Error('upgrade should not have succeeded without token'));
      });
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(401);
        resolve();
      });
      ws.on('error', () => {
        // Some Node versions surface this through the error event; either
        // is acceptable as long as the upgrade did not succeed.
        resolve();
      });
    });
  });

  it('rejects upgrade with 401 when Bearer token is wrong', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${wsBaseUrl}/api/v1/agents/connect`, {
        headers: { authorization: 'Bearer ag_definitely_not_a_real_token' },
      });
      ws.on('open', () => reject(new Error('upgrade should not succeed')));
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(401);
        resolve();
      });
      ws.on('error', () => resolve());
    });
  });

  it('accepts upgrade and sends hello frame on valid Bearer auth', async () => {
    const { ws, hello } = await connectAgent(RAW_TOKEN);
    expect(hello.type).toBe('hello');
    if (hello.type !== 'hello') throw new Error('unreachable');
    expect(hello.protocolVersion).toBe(1);
    expect(hello.agentId).toBe(AGENT_ID);
    expect(hello.serverConnectionId.length).toBeGreaterThan(0);
    ws.close();
  });

  it('round-trips a decide → decide.response through the registry-backed adapter', async () => {
    const { ws, serverFrames } = await connectAgent(RAW_TOKEN);

    // Orchestrator side: same code path the match-runner takes.
    const adapter = new WerewolfWsAgentAdapter(AGENT_ID, 'WsTestAgent', agentRegistry);
    const decisionPromise = adapter.requestDecision(buildRequest());

    // Agent side: wait for the platform's decide frame, respond.
    const decideFrame = await waitForFrame(serverFrames, 'decide');
    expect(decideFrame.request.requestId).toBe('req-e2e-1');

    const response: AgentWsClientMessage = {
      type: 'decide.response',
      correlationId: decideFrame.correlationId,
      action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
    };
    ws.send(JSON.stringify(response));

    const result = await decisionPromise;
    expect(result.requestId).toBe('req-e2e-1');
    expect(result.agentId).toBe(AGENT_ID);
    expect(result.action).toEqual({ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' });

    ws.close();
  });

  it('AgentOfflineError when adapter dispatches with no live connection', async () => {
    const adapter = new WerewolfWsAgentAdapter('00000000-0000-4000-8000-000000000000', 'NoSuch', agentRegistry);
    await expect(adapter.requestDecision(buildRequest())).rejects.toThrow(/no live WS connection/);
  });
});

// ─── P3: agent.status pub/sub roundtrip ─────────────────────────────────────
// Verifies the full plumbing wired in P3:
//   AgentConnectionRegistry → RealtimeHub.publish → /ws subscriber.
// A second WS client (the "lobby UI") subscribes to
// `agent.status:<agentId>` and observes `agent.online` when the agent's
// /agents/connect opens, and `agent.offline` when it closes.

// Subscribe a /ws client to a topic; resolve with a frames buffer that
// the test polls. The /ws route at apps/api/src/routes/ws.ts accepts
// anonymous subscriptions for public topics (LOBBY, match:*, table:*,
// agent.status:*) — no auth headers needed.
async function openLobbyWs(topic: string): Promise<{
  ws: WebSocket;
  frames: Array<{ topic: string; type: string; payload: Record<string, unknown> }>;
}> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}/ws`);
    const frames: Array<{ topic: string; type: string; payload: Record<string, unknown> }> = [];
    ws.on('message', (raw) => {
      try {
        frames.push(JSON.parse(raw.toString()));
      } catch {
        // ignore malformed
      }
    });
    ws.on('open', () => {
      ws.send(JSON.stringify({ topic, type: 'subscribe', payload: {} }));
      // Give Fastify a tick to process the subscribe message before
      // returning. Without this, a publish that fires immediately after
      // the agent /agents/connect upgrade can race the subscribe.
      setTimeout(() => resolve({ ws, frames }), 50);
    });
    ws.on('unexpected-response', (_req, res) =>
      reject(new Error(`/ws upgrade failed: ${res.statusCode}`)),
    );
    ws.on('error', reject);
  });
}

async function waitForLobbyFrame(
  frames: Array<{ topic: string; type: string; payload: Record<string, unknown> }>,
  predicate: (f: { topic: string; type: string; payload: Record<string, unknown> }) => boolean,
  timeoutMs = 2_000,
): Promise<{ topic: string; type: string; payload: Record<string, unknown> }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = frames.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timeout waiting for matching lobby frame`);
}

describe('agent.status pub/sub (P3 plumbing)', () => {
  it('publishes agent.online to subscribers when an agent connects, agent.offline when it disconnects', async () => {
    const topic = `agent.status:${AGENT_ID}`;
    const lobby = await openLobbyWs(topic);

    // Open the agent's reverse-WS. registry.register → hub.publish on
    // the agent.status topic; the lobby subscriber sees it.
    const agentConn = await connectAgent(RAW_TOKEN);

    const onlineMsg = await waitForLobbyFrame(lobby.frames, (f) =>
      f.topic === topic && f.type === 'agent.online',
    );
    expect(onlineMsg.payload).toMatchObject({ agentId: AGENT_ID });
    expect(typeof onlineMsg.payload['ts']).toBe('number');

    // Disconnect the agent → registry.unregister → publish offline.
    agentConn.ws.close();

    const offlineMsg = await waitForLobbyFrame(lobby.frames, (f) =>
      f.topic === topic && f.type === 'agent.offline',
    );
    expect(offlineMsg.payload).toMatchObject({ agentId: AGENT_ID });
    expect(typeof offlineMsg.payload['ts']).toBe('number');

    lobby.ws.close();
  });

  it('rejects subscribing to the bare prefix `agent.status:` (empty agentId)', async () => {
    // The /ws route guards against an empty agentId in the topic so a
    // misbehaving client cannot flood the empty-string topic. Subscribe
    // attempt is silently dropped; no frames arrive.
    const lobby = await openLobbyWs('agent.status:');
    await connectAgent(RAW_TOKEN);
    // Wait long enough that any publish would have landed if the subscribe
    // had succeeded. Then assert no agent.status frames arrived.
    await new Promise((r) => setTimeout(r, 100));
    expect(lobby.frames.filter((f) => f.topic.startsWith('agent.status:'))).toEqual([]);
    lobby.ws.close();
  });
});
