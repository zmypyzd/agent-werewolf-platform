import { describe, expect, it } from 'vitest';
import { MemoryWerewolfMatchArtifactStore } from '@agent-poker/persistence';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';

describe('WerewolfOrchestrator.deleteMatch', () => {
  it('removes a preparing match', () => {
    const orch = new WerewolfOrchestrator();
    orch.createMatch({ gameId: 'g-x', seed: 's' });
    expect(orch.deleteMatch('g-x')).toBe(true);
    expect(orch.deleteMatch('g-x')).toBe(false); // idempotent
    expect(orch.getMatchSummary('g-x')).toBeNull();
  });

  it('removes a completed match without removing its persisted artifact', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const orch = new WerewolfOrchestrator({ artifactStore });
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-keep', seed: 's' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await orch.runMatch(matchId);
    expect(orch.deleteMatch(matchId)).toBe(true);
    expect(orch.getMatchSummary(matchId)).toBeNull();
    // Artifact survives — caller can still read it.
    expect(await artifactStore.getMatchArtifact(matchId)).not.toBeNull();
  });

  it('throws on subscribe to a deleted match', () => {
    const orch = new WerewolfOrchestrator();
    orch.createMatch({ gameId: 'g-y', seed: 's' });
    orch.deleteMatch('g-y');
    expect(() => orch.subscribe('g-y', () => {})).toThrow(/unknown match/);
  });
});
