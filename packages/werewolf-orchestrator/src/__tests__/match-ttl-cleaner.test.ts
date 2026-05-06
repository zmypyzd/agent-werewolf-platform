import { describe, expect, it } from 'vitest';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
} from '@agent-poker/persistence';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';
import { WerewolfMatchTtlCleaner } from '../match-ttl-cleaner.js';

async function setupCompletedMatch(orch: WerewolfOrchestrator, gameId: string): Promise<void> {
  const { matchId, initialState } = orch.createMatch({ gameId, seed: `seed-${gameId}` });
  for (const p of initialState.players) {
    orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
  }
  await orch.runMatch(matchId);
}

describe('WerewolfMatchTtlCleaner', () => {
  it('runOnce removes matches whose completedAt is older than ttlMs', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const traceStore = new MemoryWerewolfDecisionTraceStore();
    const orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });

    await setupCompletedMatch(orch, 'g-old');
    await setupCompletedMatch(orch, 'g-new');

    // Both matches finished nearly simultaneously in real time, so we need to
    // artificially back-date g-old's completedAt in the store so the cleaner
    // can distinguish them deterministically.
    const OLD_COMPLETED_AT = 1_000; // epoch + 1s — far in the past
    const oldRecord = await artifactStore.getMatchArtifact('g-old');
    if (!oldRecord) throw new Error('g-old artifact not found');
    await artifactStore.saveMatchArtifact({
      matchId: 'g-old',
      startedAt: 0,
      completedAt: OLD_COMPLETED_AT,
      nightCount: oldRecord.summary.nightCount,
      dayCount: oldRecord.summary.dayCount,
      stepCount: oldRecord.summary.stepCount,
      replayEventCount: oldRecord.summary.replayEventCount,
      winner: oldRecord.summary.winner,
      finalPlayers: oldRecord.summary.finalPlayers,
      fullHistory: [],
      replayEvents: [],
      decisionTraces: [],
    });

    const list = await artifactStore.listMatchArtifacts();
    const newEntry = list.find((e) => e.matchId === 'g-new')!;
    // "now" is 1 second after g-new completed; ttlMs=500 means g-old
    // (which completed at epoch+1ms) is stale but g-new (completedAt ≈ now−1s)
    // is... wait, we need now - g-new.completedAt < ttlMs.
    // Use now just 100ms after g-new finished; ttlMs = 500ms.
    // g-old completedAt = 1ms → now - 1ms >> 500ms → stale ✓
    // g-new completedAt = t2 → now - t2 = 100ms < 500ms → fresh ✓
    const now = newEntry.completedAt + 100;
    const ttlMs = 500;

    const cleaner = new WerewolfMatchTtlCleaner({
      orchestrator: orch,
      store: artifactStore,
      ttlMs,
    });
    const cleaned = await cleaner.runOnce(now);

    expect(cleaned).toContain('g-old');
    expect(cleaned).not.toContain('g-new');
    expect(orch.deleteMatch('g-old')).toBe(false); // already removed
    expect(orch.deleteMatch('g-new')).toBe(true);
  });

  it('runOnce is a no-op when no match is older than ttlMs', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const orch = new WerewolfOrchestrator({ artifactStore });
    await setupCompletedMatch(orch, 'g-fresh');
    const cleaner = new WerewolfMatchTtlCleaner({
      orchestrator: orch,
      store: artifactStore,
      ttlMs: 60_000,
    });
    const cleaned = await cleaner.runOnce(Date.now());
    expect(cleaned).toEqual([]);
    expect(orch.deleteMatch('g-fresh')).toBe(true);
  });

  it('uses Date.now() when no `now` argument is passed', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const orch = new WerewolfOrchestrator({ artifactStore });
    await setupCompletedMatch(orch, 'g-default-now');
    // ttlMs of 0 means "anything completed at or before `now` is stale", so
    // running with the default `now` (Date.now() — strictly later than the
    // match's completedAt because Date.now() advances after the await) should
    // clean it.
    const cleaner = new WerewolfMatchTtlCleaner({
      orchestrator: orch,
      store: artifactStore,
      ttlMs: 0,
    });
    const cleaned = await cleaner.runOnce();
    expect(cleaned).toEqual(['g-default-now']);
  });
});
