import { describe, expect, it } from 'vitest';
import type {
  BuildWerewolfArtifactInput,
  IWerewolfMatchArtifactStore,
  WerewolfMatchArtifactIndexEntry,
  WerewolfMatchArtifactRecord,
} from '@agent-poker/persistence';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
} from '@agent-poker/persistence';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';

describe('WerewolfOrchestrator persistence', () => {
  it('saves the match artifact when run completes', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const traceStore = new MemoryWerewolfDecisionTraceStore();
    const orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });

    const { matchId, initialState } = orch.createMatch({ gameId: 'g-persist', seed: 's-persist' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await orch.runMatch(matchId);

    const list = await artifactStore.listMatchArtifacts();
    expect(list.map((e) => e.matchId)).toContain('g-persist');
    const rec = await artifactStore.getMatchArtifact('g-persist');
    expect(rec).not.toBeNull();
    expect(rec!.summary.matchId).toBe('g-persist');
    expect(rec!.summary.history.find((h) => h.type === 'game-over')).toBeDefined();
    // history projection MUST NOT include role-assigned / night-action types
    for (const h of rec!.summary.history) {
      expect(h.type).not.toBe('role-assigned');
      expect(h.type).not.toBe('night-action');
    }
    expect(rec!.replayEvents.length).toBeGreaterThan(0);
  });

  it('does nothing when no artifact store is configured', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-no-store', seed: 's' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await expect(orch.runMatch(matchId)).resolves.toBeDefined();
  });

  it('artifact public replay events have actor identity stripped in night phases', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const orch = new WerewolfOrchestrator({ artifactStore });
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-redact', seed: 's' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await orch.runMatch(matchId);
    const rec = (await artifactStore.getMatchArtifact('g-redact'))!;
    const nightActionEvents = rec.replayEvents.filter((e) =>
      typeof e.data['phase'] === 'string' &&
      ['night-werewolf-vote', 'night-witch', 'night-seer'].includes(e.data['phase'] as string) &&
      (e.eventType === 'agent.action_requested' || e.eventType === 'agent.action_received'),
    );
    expect(nightActionEvents.length).toBeGreaterThan(0);
    for (const e of nightActionEvents) {
      expect(e.data['playerId']).toBeUndefined();
      expect(e.data['agentId']).toBeUndefined();
    }
  });

  it('persisted replay events have no seed on match.started', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const orch = new WerewolfOrchestrator({ artifactStore });
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-no-seed', seed: 's-secret' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await orch.runMatch(matchId);
    const rec = (await artifactStore.getMatchArtifact('g-no-seed'))!;
    const matchStarted = rec.replayEvents.find((e) => e.eventType === 'match.started');
    expect(matchStarted).toBeDefined();
    expect(matchStarted!.data['seed']).toBeUndefined();
    expect(matchStarted!.data['gameId']).toBe('g-no-seed');
  });

  it('a persistArtifact failure leaves the match status completed and surfaces the error', async () => {
    const failingStore: IWerewolfMatchArtifactStore = {
      async saveMatchArtifact(_input: BuildWerewolfArtifactInput): Promise<WerewolfMatchArtifactRecord> {
        throw new Error('simulated save failure');
      },
      async getMatchArtifact(): Promise<WerewolfMatchArtifactRecord | null> {
        return null;
      },
      async listMatchArtifacts(): Promise<WerewolfMatchArtifactIndexEntry[]> {
        return [];
      },
    };
    const orch = new WerewolfOrchestrator({ artifactStore: failingStore });
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-fail', seed: 's' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await expect(orch.runMatch(matchId)).rejects.toThrow(/simulated save failure/);
    // The game completed in memory; getMatchSummary still returns the result.
    const summary = orch.getMatchSummary(matchId);
    expect(summary).not.toBeNull();
    expect(summary!.winner).toBeDefined();
    // Re-running must report the match as already completed (not failed).
    await expect(orch.runMatch(matchId)).rejects.toThrow(/already completed/);
  });
});
