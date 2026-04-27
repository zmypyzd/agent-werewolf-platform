import { describe, expect, it } from 'vitest';
import { ArtifactLimitExceededError, type DecisionTrace } from '@agent-poker/shared';
import {
  MemoryDecisionTraceStore,
  ObjectDecisionTraceStore,
} from '../decision-trace-store.js';
import { MemoryObjectStore } from '../object-store.js';

const now = 1_777_280_000_000;

function makeTrace(overrides: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    traceId: 'trace-001',
    matchId: 'match-001',
    handId: 'hand-001',
    actionId: 'action-001',
    requestId: 'request-001',
    agentId: 'agent-001',
    playerId: 'player-001',
    phase: 'flop',
    publicStateHash: 'a'.repeat(64),
    privateStateHash: 'b'.repeat(64),
    legalActions: [
      { type: 'check' },
      { type: 'bet', minAmount: 100, maxAmount: 500 },
    ],
    responseAction: {
      actionType: 'bet',
      amount: 150,
    },
    appliedAction: {
      actionType: 'bet',
      amount: 150,
    },
    latencyMs: 42,
    timedOut: false,
    invalidReason: null,
    reasoningSummary: {
      intent: 'value',
      confidence: 0.72,
      riskLevel: 'medium',
      keyObservations: ['Top pair blocks many weaker calls'],
      consideredActions: [
        { actionType: 'check', reason: 'Keeps pot small out of position' },
        { actionType: 'bet', amount: 150, reason: 'Targets second-pair calls' },
      ],
    },
    createdAt: now,
    ...overrides,
  };
}

describe('DecisionTraceStore', () => {
  it('MemoryDecisionTraceStore appends and lists traces for one match', async () => {
    const store = new MemoryDecisionTraceStore();
    const first = await store.appendDecisionTrace(makeTrace({ traceId: 'trace-001' }));
    await store.appendDecisionTrace(makeTrace({
      traceId: 'trace-other-match',
      matchId: 'match-other',
    }));

    const traces = await store.listDecisionTraces('match-001');
    expect(traces).toEqual([first]);
  });

  it('MemoryDecisionTraceStore strips raw chain-of-thought fields before saving', async () => {
    const store = new MemoryDecisionTraceStore();
    const unsafeTrace = {
      ...makeTrace(),
      rawChainOfThought: 'private hidden reasoning',
      reasoningSummary: {
        ...makeTrace().reasoningSummary!,
        rawChainOfThought: 'private hidden reasoning',
      },
    } as DecisionTrace;

    const saved = await store.appendDecisionTrace(unsafeTrace);
    const loaded = await store.listDecisionTraces('match-001');

    expect(JSON.stringify(saved)).not.toContain('rawChainOfThought');
    expect(JSON.stringify(saved)).not.toContain('private hidden reasoning');
    expect(JSON.stringify(loaded)).not.toContain('rawChainOfThought');
    expect(JSON.stringify(loaded)).not.toContain('private hidden reasoning');
  });

  it('ObjectDecisionTraceStore writes and reads match decision traces as JSONL', async () => {
    const objectStore = new MemoryObjectStore();
    const store = new ObjectDecisionTraceStore(objectStore);

    await store.appendDecisionTrace(makeTrace({ traceId: 'trace-001' }));
    await store.appendDecisionTrace(makeTrace({ traceId: 'trace-002', requestId: 'request-002' }));

    const raw = await objectStore.getText('matches/match-001/decision-trace.jsonl');
    const traces = await store.listDecisionTraces('match-001');

    expect(raw?.trim().split('\n')).toHaveLength(2);
    expect(traces.map(trace => trace.traceId)).toEqual(['trace-001', 'trace-002']);
  });

  it('ObjectDecisionTraceStore rejects oversized individual traces', async () => {
    const objectStore = new MemoryObjectStore();
    const store = new ObjectDecisionTraceStore(objectStore, {
      maxTraceBytes: 10,
      maxMatchTraceBytes: 1024,
      maxTracesPerMatch: 100,
    });

    await expect(store.appendDecisionTrace(makeTrace())).rejects.toBeInstanceOf(
      ArtifactLimitExceededError,
    );
    expect(await objectStore.exists('matches/match-001/decision-trace.jsonl')).toBe(false);
  });

  it('MemoryDecisionTraceStore rejects traces beyond the per-match count limit', async () => {
    const store = new MemoryDecisionTraceStore({
      maxTraceBytes: 4096,
      maxMatchTraceBytes: 8192,
      maxTracesPerMatch: 1,
    });

    await store.appendDecisionTrace(makeTrace({ traceId: 'trace-001' }));
    await expect(store.appendDecisionTrace(makeTrace({
      traceId: 'trace-002',
      requestId: 'request-002',
    }))).rejects.toBeInstanceOf(ArtifactLimitExceededError);

    expect(await store.listDecisionTraces('match-001')).toHaveLength(1);
  });
});
