import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import { WerewolfSeatOccupiedError } from '@agent-poker/shared';
import type {
  IUserAgentConfigStore,
  UserAgentConfig,
} from '@agent-poker/persistence';
import { WerewolfLobbyRegistry } from '../werewolf-lobby-registry.js';

// Regression: inviteAgent reads seat[i].empty, awaits agentConfigStore.get,
// then writes to seat[i]. The await yields to the event loop, so two
// concurrent inviteAgent calls for the same empty seat both pass the
// initial empty check, both await, both proceed to the write — the
// second silently clobbering the first while still returning success
// to its caller. The "loser" believed their agent was seated, but it
// wasn't, and the orchestrator now has two registerAgent calls against
// the same playerId (last write wins).
//
// This test drives the race deterministically by holding both
// agentConfigStore.get() calls in unresolved promises, then resolving
// them in order. After the fix, the second call must surface SEAT_TAKEN
// instead of silently overwriting.

interface ControlledAgentConfigStore extends IUserAgentConfigStore {
  configs: Map<string, UserAgentConfig>;
  pendingGets: Array<() => void>;
  releaseAll(): Promise<void>;
}

function makeControlledStore(): ControlledAgentConfigStore {
  const configs = new Map<string, UserAgentConfig>();
  const pendingGets: Array<() => void> = [];
  return {
    configs,
    pendingGets,
    async list() {
      return [...configs.values()];
    },
    async get(userId, agentConfigId) {
      // Force every get() to suspend until the test releases it. This
      // guarantees the registry yields between the empty-check and the
      // write — i.e. the precise window the race lives in.
      await new Promise<void>((resolve) => {
        pendingGets.push(resolve);
      });
      const c = configs.get(agentConfigId);
      return c && c.userId === userId ? c : null;
    },
    async create(cfg) {
      configs.set(cfg.agentConfigId, cfg as UserAgentConfig);
      return cfg as UserAgentConfig;
    },
    async update(_u, id, _patch) {
      return configs.get(id)!;
    },
    async delete(_u, id) {
      configs.delete(id);
    },
    async releaseAll() {
      for (const resolve of [...pendingGets]) resolve();
      pendingGets.length = 0;
      // Yield once so the queued microtasks can run.
      await Promise.resolve();
    },
  };
}

describe('WerewolfLobbyRegistry — concurrent inviteAgent race on the same empty seat', () => {
  let orch: WerewolfOrchestrator;
  let registry: WerewolfLobbyRegistry;
  let store: ControlledAgentConfigStore;

  beforeEach(() => {
    orch = new WerewolfOrchestrator();
    store = makeControlledStore();
    registry = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentConfigStore: store,
    });
  });

  it('second inviteAgent for the already-claimed seat throws SEAT_TAKEN, not a silent overwrite', async () => {
    const lobby = registry.create({ name: 'race', seed: 'fixed' });

    // Two distinct users, each with their own agent config, both racing for seat 0.
    const cfgA: UserAgentConfig = {
      agentConfigId: 'cfg-A',
      userId: 'user-A',
      agentName: 'BotA',
      endpointUrl: 'https://a.test/decide',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 5000,
      description: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const cfgB: UserAgentConfig = {
      agentConfigId: 'cfg-B',
      userId: 'user-B',
      agentName: 'BotB',
      endpointUrl: 'https://b.test/decide',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 5000,
      description: null,
      createdAt: 0,
      updatedAt: 0,
    };
    store.configs.set('cfg-A', cfgA);
    store.configs.set('cfg-B', cfgB);

    // Kick both invites off; both will suspend inside store.get().
    const pA = registry.inviteAgent(lobby.gameId, 0, 'cfg-A', 'user-A').catch((e) => e);
    const pB = registry.inviteAgent(lobby.gameId, 0, 'cfg-B', 'user-B').catch((e) => e);

    // Yield long enough for both to register their pending get.
    await Promise.resolve();
    await Promise.resolve();
    expect(store.pendingGets.length).toBe(2);

    // Resolve both — the registry now resumes both calls "concurrently".
    await store.releaseAll();
    const [resA, resB] = await Promise.all([pA, pB]);

    // Exactly one succeeded, the other got SEAT_TAKEN. Order can flip
    // depending on microtask scheduling; assert symmetrically.
    const ok = [resA, resB].filter((r) => !(r instanceof Error));
    const errs = [resA, resB].filter((r): r is Error => r instanceof Error);
    expect(ok).toHaveLength(1);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toBeInstanceOf(WerewolfSeatOccupiedError);

    // The lobby's seat 0 holds the winner only — no silent clobber.
    const after = registry.get(lobby.gameId)!;
    const seat0 = after.seats[0]!;
    expect(seat0.occupant.kind).toBe('agent');
  });
});
