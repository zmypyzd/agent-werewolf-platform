import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { MemoryWerewolfDecisionTraceStore } from '@agent-poker/persistence';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { WerewolfMatchRunner } from '../match-runner.js';

describe('WerewolfMatchRunner decision-trace recording', () => {
  it('writes one trace per agent action', async () => {
    const initial = createGame({ gameId: 'g-trace', seed: 'seed-trace' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }),
      ]),
    );
    const traceStore = new MemoryWerewolfDecisionTraceStore();
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, new EventEmitter(), {
      decisionTraceStore: traceStore,
    });
    const summary = await runner.run();
    const traces = await traceStore.listDecisionTraces('g-trace');

    expect(traces.length).toBeGreaterThan(0);
    expect(traces.length).toBe(summary.stepCount);
    // sequence numbers strictly monotonic
    for (let i = 1; i < traces.length; i++) {
      expect(traces[i]!.sequence).toBe(traces[i - 1]!.sequence + 1);
    }
    // every trace has an applied action
    for (const t of traces) {
      expect(t.appliedAction).toBeDefined();
    }
  });

  it('truncates oversized intent and observations', async () => {
    const traceStore = new MemoryWerewolfDecisionTraceStore();
    // We test the recorder directly to isolate the cap logic.
    const { recordWerewolfDecisionTrace } = await import('../decision-trace-recorder.js');
    await recordWerewolfDecisionTrace({
      store: traceStore,
      matchId: 'g-cap',
      sequence: 0,
      requestId: 'r',
      agentId: 'a',
      playerId: 'p1',
      phase: 'day-vote',
      nightNumber: 0,
      dayNumber: 1,
      publicState: { gameId: 'g', phase: 'day-vote', nightNumber: 0, dayNumber: 1, players: [], history: [], winner: null },
      privateState: { selfId: 'p1', selfRole: 'villager', selfSide: 'good', knownAllies: [], seerKnowledge: [], witchView: null, hunterCanShoot: false },
      validActions: [{ type: 'day-vote', voterId: 'p1', targetId: 'p2' }],
      responseAction: { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
      appliedAction: { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
      latencyMs: 5,
      timedOut: false,
      invalidReason: null,
      fallbackReason: null,
      reasoningSummary: {
        intent: 'X'.repeat(500),
        confidence: 0.7,
        keyObservations: Array.from({ length: 30 }, (_, i) => 'O'.repeat(500) + i),
      },
      now: 1_000,
    });
    const traces = await traceStore.listDecisionTraces('g-cap');
    expect(traces).toHaveLength(1);
    const t = traces[0]!;
    expect(t.reasoningSummary!.intent.length).toBeLessThanOrEqual(200);
    expect(t.reasoningSummary!.keyObservations.length).toBeLessThanOrEqual(10);
    for (const obs of t.reasoningSummary!.keyObservations) {
      expect(obs.length).toBeLessThanOrEqual(200);
    }
  });
});
