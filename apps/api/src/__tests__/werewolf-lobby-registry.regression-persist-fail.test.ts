import { describe, it, expect, vi } from 'vitest';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import type {
  IUserAgentConfigStore,
  IWerewolfMatchArtifactStore,
  WerewolfMatchArtifactRecord,
  WerewolfMatchArtifactIndexEntry,
} from '@agent-poker/persistence';
import type { BuildWerewolfArtifactInput } from '@agent-poker/persistence';
import { ServiceUnavailableError } from '@agent-poker/shared';
import { WerewolfLobbyRegistry } from '../werewolf-lobby-registry.js';

// Regression: when the game loop completes successfully but
// saveMatchArtifact throws (e.g. ServiceUnavailableError because
// werewolf_matches_public lacks SELECT grant for the API role — see
// PR #4), the registry's catch was flattening "post-game persistence
// failed" into entry.status='failed', overwriting the orchestrator's
// careful "completed-with-warning" state. Spectators polling
// /werewolf-games/:id then saw the match as failed even though the
// in-memory summary was complete and authoritative.
//
// Now: registry checks the orchestrator's getMatchSummary post-throw.
// If a summary exists, the game itself succeeded — keep entry as
// 'completed' and surface the persistence error to console.error.
// Only when the orchestrator never produced a summary do we mark the
// lobby 'failed'.

class AlwaysFailingArtifactStore implements IWerewolfMatchArtifactStore {
  attempts = 0;
  async saveMatchArtifact(_input: BuildWerewolfArtifactInput): Promise<WerewolfMatchArtifactRecord> {
    this.attempts++;
    throw new ServiceUnavailableError(
      'synthetic persistence failure (werewolf_matches_public not granted)',
    );
  }
  async getMatchArtifact(): Promise<WerewolfMatchArtifactRecord | null> {
    return null;
  }
  async listMatchArtifacts(): Promise<WerewolfMatchArtifactIndexEntry[]> {
    return [];
  }
  async deleteMatchArtifact(): Promise<void> {
    /* no-op for tests */
  }
}

function makeMockAgentConfigStore(): IUserAgentConfigStore {
  return {
    async list() { return []; },
    async get() { return null; },
    async create(cfg) {
      // Cast to UserAgentConfig — the store contract requires returning a
      // record with createdAt/updatedAt populated; for the test path we
      // never read those fields back so the runtime cast is safe.
      const now = Date.now();
      return { ...cfg, createdAt: now, updatedAt: now };
    },
    async update(_u, _id, _patch) { throw new Error('not implemented in test'); },
    async delete() {},
  };
}

describe('WerewolfLobbyRegistry — completes despite post-game artifact persist failure', () => {
  it('keeps lobby status=completed when saveMatchArtifact throws after the match finishes', async () => {
    const failingArtifactStore = new AlwaysFailingArtifactStore();
    const orch = new WerewolfOrchestrator({ artifactStore: failingArtifactStore });
    const registry = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
      npcThinkingDelayRange: [0, 0],
      agentConfigStore: makeMockAgentConfigStore(),
    });

    // Silence the expected console.error so test output stays clean.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const created = registry.create({ name: 'persist-fail', seed: 'fixed-seed-pf' });
    registry.fillWithNpcs(created.gameId);

    await registry.start(created.gameId);
    // Wait one microtask cycle for the fire-and-forget run-promise to settle.
    // start() returns void; the actual completion path is internal.
    await new Promise((r) => setTimeout(r, 0));
    // The match runs synchronously to completion under random NPCs (fast),
    // but flush a few extra cycles to be safe.
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    const entry = registry.get(created.gameId)!;

    // Persistence WAS attempted.
    expect(failingArtifactStore.attempts).toBeGreaterThan(0);

    // Lobby state reflects success — match completed in-memory.
    expect(entry.status).toBe('completed');
    expect(entry.winner).toBeDefined();
    expect(entry.finalPlayers).toBeDefined();
    expect(entry.finalPlayers!.length).toBe(9);
    expect(entry.failureReason).toBeUndefined();

    // The persistence error surfaced via console.error (not silently swallowed).
    expect(consoleErrorSpy).toHaveBeenCalled();
    const calls = consoleErrorSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(calls).toMatch(/post-game persistence failed/);
    expect(calls).toContain(created.gameId);

    consoleErrorSpy.mockRestore();
  });
});
