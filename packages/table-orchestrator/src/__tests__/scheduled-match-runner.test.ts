import { describe, expect, it } from 'vitest';
import {
  MemoryDecisionTraceStore,
  MemoryHandStore,
  MemoryMatchArtifactStore,
  MemoryTableStore,
} from '@agent-poker/persistence';
import { ScheduledMatchRunner } from '../scheduled-match-runner.js';

describe('ScheduledMatchRunner', () => {
  it('runs a bounded mock-agent match and saves a match artifact', async () => {
    const handStore = new MemoryHandStore();
    const tableStore = new MemoryTableStore();
    const matchArtifactStore = new MemoryMatchArtifactStore();
    const decisionTraceStore = new MemoryDecisionTraceStore();
    const runner = new ScheduledMatchRunner(
      tableStore,
      handStore,
      matchArtifactStore,
      decisionTraceStore,
    );

    const result = await runner.run({
      name: 'Daily Mock Match',
      seed: 'daily-seed',
      numHands: 2,
      agents: [
        { name: 'Caller', strategy: 'always-call', buyIn: 1000 },
        { name: 'Folder', strategy: 'always-fold', buyIn: 1000 },
      ],
    });

    expect(result.handCount).toBeGreaterThan(0);
    expect(result.handCount).toBeLessThanOrEqual(2);
    const artifact = await matchArtifactStore.getMatchArtifact(result.matchId, { includeReplayEvents: false });
    expect(artifact?.summary.name).toBe('Daily Mock Match');
    expect(artifact?.manifest.files.decisionTrace.path).toBe('decision-trace.jsonl');
    expect(artifact?.decisionTraces.length).toBeGreaterThan(0);
  });

  it('rejects scheduled matches above the 20-hand cap', async () => {
    const runner = new ScheduledMatchRunner(
      new MemoryTableStore(),
      new MemoryHandStore(),
      new MemoryMatchArtifactStore(),
    );

    await expect(runner.run({
      name: 'Too Large',
      seed: 'too-large',
      numHands: 21,
      agents: [
        { name: 'Caller', strategy: 'always-call', buyIn: 1000 },
        { name: 'Folder', strategy: 'always-fold', buyIn: 1000 },
      ],
    })).rejects.toThrow('numHands must be between 1 and 20');
  });
});
