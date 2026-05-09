import { describe, it, expect, vi } from 'vitest';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import type { IUserAgentConfigStore, UserAgentConfig } from '@agent-poker/persistence';
import { WerewolfLobbyRegistry } from '../werewolf-lobby-registry.js';

// Regression: publicEntry used a destructure-and-omit pattern that kept
// biting. Most recently, the `creatorUserId` field added for host-only
// authorization (see overnight-qa/lobby-creator-only-start) leaked through
// publicEntry until the omit list was updated — the bug was caught by my
// own follow-up review, but the underlying pattern guarantees it will
// happen again the next time a field is added to InternalEntry without
// also remembering to update the omit list.
//
// Structural fix: publicEntry is now an allowlist projection — only the
// fields explicitly named in PUBLIC_ENTRY_FIELDS make it across the
// boundary. The compile-time `_AllPublicFieldsCovered` check ensures the
// allowlist stays in sync with WerewolfLobbyEntry's keys. This test pins
// the runtime side of that contract: every public entry has *only* keys
// from the allowlist, regardless of how many internal fields the entry
// happens to carry.

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

const PUBLIC_KEYS = new Set([
  'gameId',
  'name',
  'status',
  'seats',
  'createdAt',
  'startedAt',
  'completedAt',
  'winner',
  'failureReason',
  'finalPlayers',
  'currentPhase',
  'dayNumber',
  'nightNumber',
]);

describe('WerewolfLobbyRegistry — publicEntry allowlist projection', () => {
  it('returned entry contains only fields from the public allowlist', () => {
    const orch = new WerewolfOrchestrator();
    const registry = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentConfigStore: makeMockAgentConfigStore(),
    });

    const entry = registry.create({
      name: 'allowlist-test',
      seed: 'leak-canary-seed-XYZ',
      // Anything that should NOT make it out — keeping the host's userId in
      // the test deliberately different from any real session id so a leak
      // would be obvious.
      creatorUserId: 'leak-canary-host-user-id',
    });

    for (const key of Object.keys(entry)) {
      expect(PUBLIC_KEYS, `unexpected public entry field: ${key}`).toContain(key);
    }

    // Spot-checks on the canary values.
    const json = JSON.stringify(entry);
    expect(json).not.toContain('leak-canary-seed-XYZ');
    expect(json).not.toContain('leak-canary-host-user-id');
    expect(json).not.toContain('rosterByPlayerId');
    expect(json).not.toContain('deathsByPlayerId');
    expect(json).not.toContain('matchPk');
  });

  it('publicEntry projection holds even after seats are populated and status flips', async () => {
    const orch = new WerewolfOrchestrator();
    const registry = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentConfigStore: makeMockAgentConfigStore(),
    });
    const created = registry.create({
      name: 'allowlist-fill',
      seed: 'fill-canary-seed-ABC',
      creatorUserId: 'fill-canary-host-id',
    });
    registry.fillWithNpcs(created.gameId, 'fill-canary-host-id');

    const ready = registry.get(created.gameId)!;
    for (const key of Object.keys(ready)) {
      expect(PUBLIC_KEYS, `unexpected public entry field: ${key}`).toContain(key);
    }
    expect(JSON.stringify(ready)).not.toContain('fill-canary-seed-ABC');
    expect(JSON.stringify(ready)).not.toContain('fill-canary-host-id');
  });
});
