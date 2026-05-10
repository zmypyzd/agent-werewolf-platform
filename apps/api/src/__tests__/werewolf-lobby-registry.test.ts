import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import type { IUserAgentConfigStore, UserAgentConfig } from '@agent-poker/persistence';
import { WerewolfLobbyRegistry } from '../werewolf-lobby-registry.js';

// Minimal in-memory agentConfigStore for tests. Default behavior:
// - list/get returns empty/null so the existing npc-only tests don't change
// - create/update/delete are no-ops; they shouldn't be hit by registry code
// Individual tests that exercise inviteAgent() can install configs by pushing
// into `configs` directly.
function makeMockAgentConfigStore(): IUserAgentConfigStore & {
  configs: Map<string, UserAgentConfig>;
} {
  const configs = new Map<string, UserAgentConfig>();
  return {
    configs,
    async list() { return [...configs.values()]; },
    async get(userId, agentConfigId) {
      const c = configs.get(agentConfigId);
      return c && c.userId === userId ? c : null;
    },
    async create(cfg) { configs.set(cfg.agentConfigId, cfg as UserAgentConfig); return cfg as UserAgentConfig; },
    async update(_u, id, _patch) { return configs.get(id)!; },
    async delete(_u, id) { configs.delete(id); },
  };
}

describe('WerewolfLobbyRegistry', () => {
  let orch: WerewolfOrchestrator;
  let registry: WerewolfLobbyRegistry;
  let agentConfigStore: ReturnType<typeof makeMockAgentConfigStore>;

  beforeEach(() => {
    orch = new WerewolfOrchestrator();
    agentConfigStore = makeMockAgentConfigStore();
    registry = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentConfigStore,
    });
  });

  it('creates a game with 9 empty seats and waiting status', () => {
    const entry = registry.create({ name: 'demo' });
    expect(entry.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.name).toBe('demo');
    expect(entry.status).toBe('waiting');
    expect(entry.seats).toHaveLength(9);
    expect(
      entry.seats.every((s, i) => s.seatIndex === i && s.playerId === `p${i + 1}`),
    ).toBe(true);
    expect(entry.seats.every((s) => s.occupant.kind === 'empty')).toBe(true);
  });

  it('never exposes seed in the returned entry', () => {
    const entry = registry.create({ name: 'demo', seed: 'top-secret' });
    expect(JSON.stringify(entry)).not.toContain('top-secret');
    expect(JSON.stringify(entry)).not.toContain('seed');
  });

  it('never exposes creatorUserId in the returned entry (privacy)', () => {
    // Regression: creatorUserId is the host's session userId. Exposing it
    // would let any spectator pivot from the public lobby list to a
    // per-host enumeration ("which lobbies belong to user X?"). Pinned
    // at the create() seam and the get() seam below.
    const entry = registry.create({
      name: 'demo',
      creatorUserId: 'user-host-secret-id-aaaa-bbbb-cccc-dddddddd',
    });
    expect(JSON.stringify(entry)).not.toContain('user-host-secret-id');
    expect(JSON.stringify(entry)).not.toContain('creatorUserId');

    const refetched = registry.get(entry.gameId);
    expect(JSON.stringify(refetched)).not.toContain('user-host-secret-id');
    expect(JSON.stringify(refetched)).not.toContain('creatorUserId');
  });

  it('inviteNpc fills exactly one seat and registers an agent with the orchestrator', () => {
    const entry = registry.create({ name: 'demo', seed: 'fixed' });
    const updated = registry.inviteNpc(entry.gameId, 0);
    const seat = updated.seats[0]!;
    expect(seat.occupant.kind).toBe('npc');
    if (seat.occupant.kind === 'npc') {
      expect(seat.occupant.agentId).toBe('agent-p1');
      expect(typeof seat.occupant.displayName).toBe('string');
    }
    expect(updated.seats.slice(1).every((s) => s.occupant.kind === 'empty')).toBe(true);
    expect(updated.status).toBe('waiting');
  });

  it('inviteNpc rejects an occupied seat', () => {
    const { gameId } = registry.create({ name: 'demo', seed: 'fixed' });
    registry.inviteNpc(gameId, 3);
    expect(() => registry.inviteNpc(gameId, 3)).toThrowError(/already occupied/);
  });

  it('inviteNpc rejects an unknown game', () => {
    expect(() => registry.inviteNpc('nope', 0)).toThrowError(/not found/);
  });

  it('fillWithNpcs fills any remaining empty seats and flips to ready', () => {
    const { gameId } = registry.create({ name: 'demo', seed: 'fixed' });
    registry.inviteNpc(gameId, 4);
    const updated = registry.fillWithNpcs(gameId);
    expect(updated.status).toBe('ready');
    expect(updated.seats.every((s) => s.occupant.kind === 'npc')).toBe(true);
  });

  it('fillWithNpcs is idempotent on a full table', () => {
    const { gameId } = registry.create({ name: 'demo', seed: 'fixed' });
    registry.fillWithNpcs(gameId);
    const second = registry.fillWithNpcs(gameId);
    expect(second.status).toBe('ready');
  });

  it('start rejects when not ready', () => {
    const { gameId } = registry.create({ name: 'demo' });
    expect(() => registry.start(gameId)).toThrowError(/NOT_READY|cannot start/);
  });

  // ---- inviteAgent (D2/D5) -------------------------------------------------

  function installCfg(userId: string, agentConfigId = 'cfg-test-1') {
    const cfg = {
      agentConfigId,
      userId,
      agentName: 'gpt-werewolf',
      endpointUrl: 'https://example.test/agent',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 5000,
      description: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    agentConfigStore.configs.set(agentConfigId, cfg);
    return cfg;
  }

  it('inviteAgent fills the seat and registers an HTTP adapter', async () => {
    const { gameId } = registry.create({ name: 'demo' });
    installCfg('user-1', 'cfg-A');
    const updated = await registry.inviteAgent(gameId, 0, 'cfg-A', 'user-1');
    const seat = updated.seats[0]!;
    expect(seat.occupant.kind).toBe('agent');
    if (seat.occupant.kind !== 'agent') return;
    expect(seat.occupant.agentId).toBe('agent-p1');
    expect(seat.occupant.displayName).toBe('gpt-werewolf');
    // owner-only projection: when viewer === owner, isMine=true
    expect(seat.occupant.isMine).toBe(true);
  });

  it('inviteAgent isolation: cross-account access surfaces as AGENT_NOT_FOUND, not 403', async () => {
    // P0 — must not leak whether cfg exists for another user.
    const { gameId } = registry.create({ name: 'demo' });
    installCfg('owner-A', 'cfg-A');
    await expect(
      registry.inviteAgent(gameId, 0, 'cfg-A', 'attacker-B'),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
  });

  it('inviteAgent rejects same cfg into two seats of one game (within-game in-use)', async () => {
    const { gameId } = registry.create({ name: 'demo' });
    installCfg('user-1', 'cfg-A');
    await registry.inviteAgent(gameId, 0, 'cfg-A', 'user-1');
    await expect(
      registry.inviteAgent(gameId, 1, 'cfg-A', 'user-1'),
    ).rejects.toMatchObject({ code: 'AGENT_IN_USE' });
  });

  it('publicEntry never leaks ownerUserId or agentConfigId, regardless of viewer', async () => {
    const { gameId } = registry.create({ name: 'demo' });
    installCfg('owner-1', 'cfg-secret');
    await registry.inviteAgent(gameId, 0, 'cfg-secret', 'owner-1');
    // anonymous viewer
    const anon = registry.get(gameId)!;
    const json = JSON.stringify(anon);
    expect(json).not.toContain('owner-1');
    expect(json).not.toContain('cfg-secret');
    // owner viewer — should ALSO not contain those raw fields, only isMine
    const ownerView = registry.get(gameId, 'owner-1')!;
    const ownerJson = JSON.stringify(ownerView);
    expect(ownerJson).not.toContain('owner-1');
    expect(ownerJson).not.toContain('cfg-secret');
    expect(ownerJson).toContain('"isMine":true');
  });

  it('publicEntry does NOT set isMine for non-owner viewers', async () => {
    const { gameId } = registry.create({ name: 'demo' });
    installCfg('owner-1', 'cfg-A');
    await registry.inviteAgent(gameId, 0, 'cfg-A', 'owner-1');
    const otherView = registry.get(gameId, 'someone-else')!;
    const seat = otherView.seats[0]!;
    expect(seat.occupant.kind).toBe('agent');
    if (seat.occupant.kind === 'agent') {
      expect(seat.occupant.isMine).toBeUndefined();
    }
  });

  it('isAgentConfigInUse reflects active waiting/ready/running games only', async () => {
    expect(registry.isAgentConfigInUse('cfg-A')).toBe(false);
    const { gameId } = registry.create({ name: 'demo' });
    installCfg('user-1', 'cfg-A');
    await registry.inviteAgent(gameId, 0, 'cfg-A', 'user-1');
    expect(registry.isAgentConfigInUse('cfg-A')).toBe(true);
  });

  it('inviteAgent + npcs flips status to ready when all 9 seats filled (mixed kinds)', async () => {
    const { gameId } = registry.create({ name: 'demo' });
    installCfg('user-1', 'cfg-A');
    await registry.inviteAgent(gameId, 0, 'cfg-A', 'user-1');
    for (let i = 1; i < 9; i++) registry.inviteNpc(gameId, i);
    const after = registry.get(gameId)!;
    expect(after.status).toBe('ready');
  });

  it('start flips status to running and calls attachMatch', () => {
    const attachMatch = vi.fn();
    const reg = new WerewolfLobbyRegistry({
      orchestrator: new WerewolfOrchestrator(),
      attachMatch,
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentConfigStore: makeMockAgentConfigStore(),
    });
    const { gameId } = reg.create({ name: 'demo', seed: 'fixed' });
    reg.fillWithNpcs(gameId);
    const promise = reg.start(gameId);
    promise.catch(() => { /* may resolve later in this test */ });
    const after = reg.get(gameId)!;
    expect(after.status).toBe('running');
    expect(attachMatch).toHaveBeenCalledWith(gameId, []);
  });

  it('list returns summaries (no seats[]) sorted recent-first', async () => {
    registry.create({ name: 'a' });
    await new Promise((r) => setTimeout(r, 2));
    registry.create({ name: 'b' });
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe('b');
    expect(list[0]!.seatedCount).toBe(0);
    expect((list[0] as unknown as Record<string, unknown>).seats).toBeUndefined();
  });

  it('records winner + finalPlayers when the orchestrator completes', async () => {
    const realOrch = new WerewolfOrchestrator();
    const reg = new WerewolfLobbyRegistry({
      orchestrator: realOrch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentConfigStore: makeMockAgentConfigStore(),
    });
    const { gameId } = reg.create({ name: 'real', seed: 'werewolf-seed-001' });
    reg.fillWithNpcs(gameId);
    const promise = reg.start(gameId);
    await promise;
    const after = reg.get(gameId)!;
    expect(after.status).toBe('completed');
    expect(after.winner).toMatch(/good|werewolf/);
    expect(after.finalPlayers).toHaveLength(9);
    expect(after.completedAt).toBeGreaterThan(0);
  });

  it('ISSUE-005: seats carry alive/causeOfDeath for running and completed games', async () => {
    // Pre-start: alive and causeOfDeath must be absent (info-isolation invariant)
    const { gameId } = registry.create({ name: 'iso' });
    registry.fillWithNpcs(gameId);
    const ready = registry.get(gameId)!;
    expect(ready.status).toBe('ready');
    for (const s of ready.seats) {
      expect(s).not.toHaveProperty('alive');
      expect(s).not.toHaveProperty('causeOfDeath');
    }

    // Running game: all players alive immediately after start (no deaths yet)
    const realOrch = new WerewolfOrchestrator();
    const reg = new WerewolfLobbyRegistry({
      orchestrator: realOrch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentConfigStore: makeMockAgentConfigStore(),
    });
    const { gameId: gid } = reg.create({ name: 'iso2', seed: 'werewolf-seed-001' });
    reg.fillWithNpcs(gid);
    const runPromise = reg.start(gid);
    runPromise.catch(() => { /* ignore in-test */ });
    const running = reg.get(gid)!;
    expect(running.status).toBe('running');
    for (const s of running.seats) {
      expect(s.alive).toBe(true);
    }

    // Completed game: seats reflect final alive state from tracked deaths
    await runPromise;
    const completed = reg.get(gid)!;
    expect(completed.status).toBe('completed');
    const deadSeats = completed.seats.filter((s) => s.alive === false);
    expect(deadSeats.length).toBeGreaterThan(0);
    for (const s of deadSeats) {
      expect(['wolf-kill', 'witch-poison', 'banishment', 'hunter-shoot']).toContain(s.causeOfDeath);
    }
    // Cross-check: seats alive:false must match finalPlayers alive:false count
    const finalDead = completed.finalPlayers?.filter((p) => !p.alive) ?? [];
    expect(deadSeats.length).toBe(finalDead.length);
  });

  it('phase backfill: lobby entry tracks currentPhase/dayNumber/nightNumber from phase.changed', async () => {
    // Late-joining spectators see only the phase metadata that the lobby
    // poll carries — SSE has no backlog. Pin that the registry mirrors the
    // last phase.changed payload onto the entry.
    const realOrch = new WerewolfOrchestrator();
    const reg = new WerewolfLobbyRegistry({
      orchestrator: realOrch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentConfigStore: makeMockAgentConfigStore(),
    });

    // Pre-start: phase metadata absent (matches the info-isolation invariant
    // pinned in werewolf-games-info-isolation.test.ts).
    const { gameId } = reg.create({ name: 'phase-track', seed: 'werewolf-seed-001' });
    reg.fillWithNpcs(gameId);
    const ready = reg.get(gameId)!;
    expect(ready).not.toHaveProperty('currentPhase');
    expect(ready).not.toHaveProperty('dayNumber');
    expect(ready).not.toHaveProperty('nightNumber');

    // Start the match and let it run to completion — the orchestrator
    // emits a phase.changed for every transition, so by the end the
    // entry will have observed many of them.
    const runPromise = reg.start(gameId);
    await runPromise;
    const completed = reg.get(gameId)!;
    expect(completed.status).toBe('completed');
    // The final phase a match settles in is 'game-over'. nightNumber and
    // dayNumber must both be numbers (the engine tracks both throughout
    // the match — see packages/werewolf-orchestrator/src/match-runner.ts).
    expect(typeof completed.currentPhase).toBe('string');
    expect(completed.currentPhase).toBe('game-over');
    expect(typeof completed.nightNumber).toBe('number');
    expect(typeof completed.dayNumber).toBe('number');
    expect(completed.nightNumber).toBeGreaterThanOrEqual(1);
    expect(completed.dayNumber).toBeGreaterThanOrEqual(1);
  });

  // Regression for the production fault `resolveMatchPk: no match for game_id <id>`:
  // when a Postgres-backed match registry is wired in, lobby.start() MUST
  // call registry.createMatch BEFORE the orchestrator emits any decision
  // trace. Without this, the trace store's resolveMatchPk lookup finds no
  // werewolf_matches row and the run fails on the first agent decision.
  it('start() persists the match via matchRegistry before runMatch begins', async () => {
    const calls: Array<{
      gameId: string;
      ownerId: string | null;
      seed: string;
      seatCount: number;
    }> = [];
    const fakeRegistry = {
      createMatch: vi.fn(async (input: {
        gameId: string;
        ownerId: string | null;
        seed: string;
        seats: ReadonlyArray<unknown>;
      }) => {
        calls.push({
          gameId: input.gameId,
          ownerId: input.ownerId,
          seed: input.seed,
          seatCount: input.seats.length,
        });
        return {
          matchPk: 'fake-pk-' + input.gameId.slice(0, 8),
          gameId: input.gameId,
          status: 'running' as const,
          startedAt: Date.now(),
        };
      }),
      abortMatch: vi.fn(async () => {}),
      getStatus: vi.fn(async () => null),
      resolveMatchPk: vi.fn(async () => 'unused'),
      // exposed for parity with the Postgres impl; tests don't drive the cache
      clearCache: vi.fn(() => {}),
    };
    const appendedEvents: Array<{ matchPk: string; eventType: string }> = [];
    const fakeReplayStore = {
      appendEvent: vi.fn(async (matchPk: string, event: { eventType: string }) => {
        appendedEvents.push({ matchPk, eventType: event.eventType });
      }),
      appendEvents: vi.fn(async () => {}),
      listEvents: vi.fn(async () => []),
    };
    const realOrch = new WerewolfOrchestrator();
    const reg = new WerewolfLobbyRegistry({
      orchestrator: realOrch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentConfigStore: makeMockAgentConfigStore(),
      matchRegistry: fakeRegistry,
      replayEventStore: fakeReplayStore,
    });
    const { gameId } = reg.create({ name: 'pg', seed: 'werewolf-seed-001' });
    reg.fillWithNpcs(gameId);
    await reg.start(gameId);

    // createMatch was called exactly once with the lobby's gameId+seed and 9 seats.
    expect(fakeRegistry.createMatch).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      { gameId, ownerId: null, seed: 'werewolf-seed-001', seatCount: 9 },
    ]);

    // The match completed without falling into the "no match for game_id"
    // failure path — i.e. the createMatch happened before runMatch needed it.
    const completed = reg.get(gameId)!;
    expect(completed.status).toBe('completed');
    expect(completed.failureReason).toBeUndefined();

    // Info-isolation regression: matchPk is a werewolf_matches.id UUID kept
    // on the internal entry for downstream Postgres calls. It must NEVER
    // appear in the public lobby projection — same defense-in-depth as the
    // existing seed / roster omission. Pin both the property and the literal
    // string so a future spread that accidentally includes it gets caught.
    const fakeMatchPk = 'fake-pk-' + gameId.slice(0, 8);
    expect(completed).not.toHaveProperty('matchPk');
    expect(JSON.stringify(completed)).not.toContain(fakeMatchPk);

    // Live replay events were forwarded with the matchPk we returned, not
    // the gameId — the trace store's resolveMatchPk indirection is the whole
    // reason this fix exists.
    expect(appendedEvents.length).toBeGreaterThan(0);
    expect(appendedEvents.every((e) => e.matchPk === 'fake-pk-' + gameId.slice(0, 8))).toBe(true);
  });
});
