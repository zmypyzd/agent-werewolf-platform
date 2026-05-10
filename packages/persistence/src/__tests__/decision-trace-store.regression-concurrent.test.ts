import { describe, expect, it } from 'vitest';
import type { DecisionTrace } from '@agent-poker/shared';
import {
  MemoryDecisionTraceStore,
  ObjectDecisionTraceStore,
} from '../decision-trace-store.js';
import { MemoryObjectStore } from '../object-store.js';

// Regression: ObjectDecisionTraceStore.appendDecisionTrace performed a
// read-modify-write across two awaits with no concurrency primitive (the
// poker-side mirror of the werewolf decision-trace race fixed in the same
// PR). See werewolf-decision-trace-store.regression-concurrent.test.ts for
// the full rationale.

function makeTrace(overrides: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    traceId: 'trace-default',
    matchId: 'match-concurrent',
    handId: 'hand-001',
    actionId: 'action-001',
    requestId: 'request-001',
    agentId: 'agent-001',
    playerId: 'player-001',
    phase: 'flop',
    publicStateHash: 'a'.repeat(64),
    privateStateHash: 'b'.repeat(64),
    legalActions: [{ type: 'check' }],
    responseAction: { actionType: 'check', amount: 0 },
    appliedAction: { actionType: 'check', amount: 0 },
    latencyMs: 42,
    timedOut: false,
    invalidReason: null,
    reasoningSummary: null,
    createdAt: 1_777_280_000_000,
    ...overrides,
  };
}

describe('Decision-trace store — concurrent appendDecisionTrace', () => {
  it('MemoryDecisionTraceStore: 10 concurrent appends preserve every trace', async () => {
    const store = new MemoryDecisionTraceStore();
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.appendDecisionTrace(makeTrace({ traceId: `t${i}` })),
      ),
    );
    const list = await store.listDecisionTraces('match-concurrent');
    expect(list.map((t) => t.traceId).sort()).toEqual(
      Array.from({ length: N }, (_, i) => `t${i}`).sort(),
    );
  });

  it('ObjectDecisionTraceStore: 10 concurrent appends preserve every trace', async () => {
    const store = new ObjectDecisionTraceStore(new MemoryObjectStore());
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.appendDecisionTrace(makeTrace({ traceId: `t${i}` })),
      ),
    );
    const list = await store.listDecisionTraces('match-concurrent');
    expect(list.map((t) => t.traceId).sort()).toEqual(
      Array.from({ length: N }, (_, i) => `t${i}`).sort(),
    );
  });

  it('ObjectDecisionTraceStore: per-matchId mutex isolates different matches', async () => {
    const store = new ObjectDecisionTraceStore(new MemoryObjectStore());
    await Promise.all([
      store.appendDecisionTrace(makeTrace({ matchId: 'match-A', traceId: 'A1' })),
      store.appendDecisionTrace(makeTrace({ matchId: 'match-A', traceId: 'A2' })),
      store.appendDecisionTrace(makeTrace({ matchId: 'match-B', traceId: 'B1' })),
      store.appendDecisionTrace(makeTrace({ matchId: 'match-B', traceId: 'B2' })),
    ]);
    const a = await store.listDecisionTraces('match-A');
    const b = await store.listDecisionTraces('match-B');
    expect(a.map((t) => t.traceId).sort()).toEqual(['A1', 'A2']);
    expect(b.map((t) => t.traceId).sort()).toEqual(['B1', 'B2']);
  });
});
