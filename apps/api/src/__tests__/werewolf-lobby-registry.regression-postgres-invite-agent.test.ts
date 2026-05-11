import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import type {
  AgentRecord,
  CreateAgentResult,
  IAgentStore,
  IUserAgentConfigStore,
  NewAgent,
  PatchAgent,
  UserAgentConfig,
} from '@agent-poker/persistence';
import {
  AgentConnection,
  AgentConnectionRegistry,
  type AgentSocket,
} from '@agent-poker/agent-runtime';
import { WerewolfLobbyRegistry } from '../werewolf-lobby-registry.js';

class StubSocket implements AgentSocket {
  send(_data: string): void {}
  close(): void {}
}

// Regression for the prod bug captured 2026-05-11: after the auth
// migration, `/me/agents` was switched to query postgres (see
// apps/api/src/routes/me-agents.ts:60), but
// `WerewolfLobbyRegistry.inviteAgent` was still reading the SQLite
// IUserAgentConfigStore. Net effect: AgentPicker showed the user's
// postgres-registered agents, the user clicked one, the seat-time
// lookup failed in the wrong store, and the API returned AGENT_NOT_FOUND
// for an agent that demonstrably existed in the listing call.
//
// This test wires WerewolfLobbyRegistry with a postgres-shaped
// IAgentStore (mirroring production via opts.werewolfAgentStore) and
// exercises the now-supported path end-to-end.

function makeMockAgentStore(): IAgentStore & {
  records: Map<string, AgentRecord>;
} {
  const records = new Map<string, AgentRecord>();
  return {
    records,
    async list(ownerId) {
      return [...records.values()].filter((r) => r.ownerId === ownerId);
    },
    async get(ownerId, agentId) {
      const r = records.get(agentId);
      return r && r.ownerId === ownerId ? r : null;
    },
    async getById(agentId) {
      return records.get(agentId) ?? null;
    },
    async findByTokenHash() {
      return null;
    },
    async create(input: NewAgent): Promise<CreateAgentResult> {
      const id = randomUUID();
      const record: AgentRecord = {
        id,
        ownerId: input.ownerId,
        name: input.name,
        description: input.description ?? null,
        protocol: input.protocol,
        callbackUrl: input.callbackUrl ?? null,
        authHeaderName: input.authHeaderName ?? null,
        authHeaderValue: input.authHeaderValue ?? null,
        timeoutMs: input.timeoutMs ?? 15_000,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      records.set(id, record);
      return { agent: record, rawToken: null };
    },
    async update(_o, id, _patch: PatchAgent) {
      return records.get(id)!;
    },
    async rotateToken() {
      throw new Error('not implemented in mock');
    },
    async delete(_o, id) {
      records.delete(id);
    },
  };
}

function makeMockAgentConfigStore(): IUserAgentConfigStore & {
  configs: Map<string, UserAgentConfig>;
} {
  const configs = new Map<string, UserAgentConfig>();
  return {
    configs,
    async list() { return [...configs.values()]; },
    async get(userId, id) {
      const c = configs.get(id);
      return c && c.userId === userId ? c : null;
    },
    async create(cfg) { configs.set(cfg.agentConfigId, cfg as UserAgentConfig); return cfg as UserAgentConfig; },
    async update(_u, id) { return configs.get(id)!; },
    async delete(_u, id) { configs.delete(id); },
  };
}

describe('WerewolfLobbyRegistry — inviteAgent against postgres IAgentStore', () => {
  it('seats an http agent looked up from postgres agentStore', async () => {
    const orch = new WerewolfOrchestrator();
    const agentStore = makeMockAgentStore();
    const registry = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentStore,
    });

    const ownerUserId = 'user-alice';
    const created = await agentStore.create({
      ownerId: ownerUserId,
      name: 'http-bot',
      description: null,
      protocol: 'http',
      callbackUrl: 'https://example.test/decide',
      authHeaderName: 'X-Auth',
      authHeaderValue: 'secret',
      timeoutMs: 12_000,
    });

    const game = registry.create({ name: 'test', seed: 'p3-prod-fix' });
    const entry = await registry.inviteAgent(
      game.gameId,
      0,
      created.agent.id,
      ownerUserId,
    );

    const seat0 = entry.seats[0]!;
    expect(seat0.occupant.kind).toBe('agent');
    if (seat0.occupant.kind !== 'agent') throw new Error('unreachable');
    expect(seat0.occupant.displayName).toBe('http-bot');
    // Public projection strips agentConfigId; verify the internal tracking
    // worked by querying the cross-game in-use checker (which iterates
    // internal seats and reads agentConfigId).
    expect(registry.isAgentConfigInUse(created.agent.id)).toBe(true);
  });

  it('returns AGENT_NOT_FOUND when the postgres record exists but is owned by someone else', async () => {
    const orch = new WerewolfOrchestrator();
    const agentStore = makeMockAgentStore();
    const registry = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentStore,
    });
    const created = await agentStore.create({
      ownerId: 'user-alice',
      name: 'alice-bot',
      description: null,
      protocol: 'http',
      callbackUrl: 'https://example.test/decide',
      timeoutMs: 12_000,
    });
    const game = registry.create({});

    await expect(
      registry.inviteAgent(game.gameId, 0, created.agent.id, 'user-bob'),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
  });

  it('refuses to seat a postgres ws agent when the lobby is constructed without an agentRegistry', async () => {
    // Without an AgentConnectionRegistry the lobby has no way to look
    // up the agent's live connection at dispatch time, so seating a
    // ws agent here would just produce a guaranteed-mute seat. Surface
    // it as INVALID_CONFIG so the deployer sees a clear "wire the
    // registry" message instead of a silent failure path.
    const orch = new WerewolfOrchestrator();
    const agentStore = makeMockAgentStore();
    const lobby = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentStore,
      // NB: agentRegistry deliberately omitted
    });
    const created = await agentStore.create({
      ownerId: 'user-alice',
      name: 'ws-bot',
      description: null,
      protocol: 'ws',
      timeoutMs: 12_000,
    });
    const game = lobby.create({});
    await expect(
      lobby.inviteAgent(game.gameId, 0, created.agent.id, 'user-alice'),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('refuses to seat a ws agent that has no live WS connection (AGENT_OFFLINE)', async () => {
    // Strict-online seat-time check: the agent's process must be
    // currently connected to /api/v1/agents/connect before the user
    // can seat it. Without the check, the seat would be filled but
    // the very first decision request would AgentOfflineError →
    // werewolfFallback every turn ("mute seat" failure mode this
    // whole PR chain exists to prevent).
    const orch = new WerewolfOrchestrator();
    const agentStore = makeMockAgentStore();
    const agentRegistry = new AgentConnectionRegistry();
    const lobby = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentStore,
      agentRegistry,
    });
    const created = await agentStore.create({
      ownerId: 'user-alice',
      name: 'ws-bot',
      description: null,
      protocol: 'ws',
      timeoutMs: 12_000,
    });
    const game = lobby.create({});
    await expect(
      lobby.inviteAgent(game.gameId, 0, created.agent.id, 'user-alice'),
    ).rejects.toMatchObject({ code: 'AGENT_OFFLINE' });
  });

  it('seats a ws agent when the registry has a live connection for it', async () => {
    const orch = new WerewolfOrchestrator();
    const agentStore = makeMockAgentStore();
    const agentRegistry = new AgentConnectionRegistry();
    const lobby = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentStore,
      agentRegistry,
    });

    const ownerUserId = 'user-alice';
    const created = await agentStore.create({
      ownerId: ownerUserId,
      name: 'ws-bot',
      description: null,
      protocol: 'ws',
      timeoutMs: 12_000,
    });
    const agentId = created.agent.id;

    // Establish a live connection (mirrors what
    // apps/api/src/routes/agents-ws.ts does on a real upgrade — the
    // registry keys by AgentConnection.agentId, which is set to the
    // postgres `agents.id` UUID after token-hash lookup).
    const conn = new AgentConnection({
      agentId,
      socket: new StubSocket(),
    });
    agentRegistry.register(conn);

    const game = lobby.create({});
    const entry = await lobby.inviteAgent(game.gameId, 0, agentId, ownerUserId);
    const seat0 = entry.seats[0]!;
    if (seat0.occupant.kind !== 'agent') throw new Error('unreachable');
    expect(seat0.occupant.displayName).toBe('ws-bot');
    // Public projection strips agentConfigId; verify via the in-use
    // joiner which iterates internal state.
    expect(lobby.isAgentConfigInUse(agentId)).toBe(true);

    // Cleanup so registry's interval timers don't keep the test runner alive.
    conn.handleSocketClosed('test-cleanup');
  });

  it('prefers postgres over SQLite when both stores have the same id', async () => {
    // Hybrid wiring (postgres set + SQLite set) is the migration window
    // state: prod will run postgres-only, but tests sometimes seed
    // SQLite fakes. Resolution order must be postgres-first so the new
    // production path is exercised even when both happen to be live.
    const orch = new WerewolfOrchestrator();
    const agentStore = makeMockAgentStore();
    const agentConfigStore = makeMockAgentConfigStore();
    const registry = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentStore,
      agentConfigStore,
    });

    const ownerUserId = 'user-alice';
    const pg = await agentStore.create({
      ownerId: ownerUserId,
      name: 'pg-bot',
      description: null,
      protocol: 'http',
      callbackUrl: 'https://pg.example/decide',
      timeoutMs: 5_000,
    });
    // Plant a same-id, different-data SQLite record. If resolveAgent
    // fell through to SQLite, the seated agent's name would be
    // 'sqlite-bot' instead of 'pg-bot'.
    agentConfigStore.configs.set(pg.agent.id, {
      agentConfigId: pg.agent.id,
      userId: ownerUserId,
      agentName: 'sqlite-bot',
      endpointUrl: 'https://sqlite.example/decide',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 5_000,
      description: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const game = registry.create({});
    const entry = await registry.inviteAgent(
      game.gameId,
      0,
      pg.agent.id,
      ownerUserId,
    );
    const seat0 = entry.seats[0]!;
    if (seat0.occupant.kind !== 'agent') throw new Error('unreachable');
    expect(seat0.occupant.displayName).toBe('pg-bot');
  });

  it('falls back to SQLite when postgres returns null (legacy fixture compat)', async () => {
    const orch = new WerewolfOrchestrator();
    const agentStore = makeMockAgentStore();
    const agentConfigStore = makeMockAgentConfigStore();
    const registry = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentStore,
      agentConfigStore,
    });
    const legacyId = 'sqlite-only-id';
    agentConfigStore.configs.set(legacyId, {
      agentConfigId: legacyId,
      userId: 'user-alice',
      agentName: 'legacy-bot',
      endpointUrl: 'https://legacy.example/decide',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 5_000,
      description: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const game = registry.create({});
    const entry = await registry.inviteAgent(
      game.gameId,
      0,
      legacyId,
      'user-alice',
    );
    const seat0 = entry.seats[0]!;
    if (seat0.occupant.kind !== 'agent') throw new Error('unreachable');
    expect(seat0.occupant.displayName).toBe('legacy-bot');
  });

  it('constructor throws if neither agentStore nor agentConfigStore is provided', () => {
    expect(() => {
      new WerewolfLobbyRegistry({
        orchestrator: new WerewolfOrchestrator(),
        attachMatch: vi.fn(),
        detachMatch: vi.fn(),
        npcThinkingDelayRange: [0, 0],
      });
    }).toThrow(/at least one of/);
  });
});
