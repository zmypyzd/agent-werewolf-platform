import { describe, expect, it } from 'vitest';
import { ArtifactLimitExceededError } from '@agent-poker/shared';
import type { WerewolfDecisionTrace } from '@agent-poker/shared';
import { MemoryObjectStore } from '../object-store.js';
import {
  MemoryWerewolfDecisionTraceStore,
  ObjectWerewolfDecisionTraceStore,
} from '../werewolf-decision-trace-store.js';

const sample = (overrides: Partial<WerewolfDecisionTrace> = {}): WerewolfDecisionTrace => ({
  traceId: 't',
  matchId: 'g-1',
  sequence: 0,
  requestId: 'r',
  agentId: 'a',
  playerId: 'p1',
  phase: 'day-vote',
  nightNumber: 0,
  dayNumber: 1,
  publicStateHash: 'sha-pub',
  privateStateHash: 'sha-priv',
  validActionTypes: ['day-vote'],
  responseAction: null,
  appliedAction: { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
  latencyMs: 10,
  timedOut: false,
  invalidReason: null,
  fallbackReason: null,
  reasoningSummary: null,
  createdAt: 1_000,
  ...overrides,
});

describe('MemoryWerewolfDecisionTraceStore', () => {
  it('appends and lists traces in insertion order', async () => {
    const store = new MemoryWerewolfDecisionTraceStore();
    await store.appendDecisionTrace(sample({ traceId: 't1', sequence: 0 }));
    await store.appendDecisionTrace(sample({ traceId: 't2', sequence: 1 }));
    const list = await store.listDecisionTraces('g-1');
    expect(list.map((t) => t.traceId)).toEqual(['t1', 't2']);
  });

  it('rejects oversized single trace', async () => {
    const store = new MemoryWerewolfDecisionTraceStore({ maxTraceBytes: 200 });
    const huge = sample({
      reasoningSummary: { intent: 'x'.repeat(1000), confidence: 0.5, keyObservations: [] },
    });
    await expect(store.appendDecisionTrace(huge)).rejects.toThrow(ArtifactLimitExceededError);
  });

  it('rejects exceeding per-match trace count', async () => {
    const store = new MemoryWerewolfDecisionTraceStore({ maxTracesPerMatch: 2 });
    await store.appendDecisionTrace(sample({ traceId: 't1' }));
    await store.appendDecisionTrace(sample({ traceId: 't2' }));
    await expect(store.appendDecisionTrace(sample({ traceId: 't3' }))).rejects.toThrow(
      ArtifactLimitExceededError,
    );
  });

  it('cleans matchId to safe path segment', async () => {
    const store = new MemoryWerewolfDecisionTraceStore();
    await expect(
      store.appendDecisionTrace(sample({ matchId: '../../etc/passwd' })),
    ).rejects.toThrow(/Invalid matchId path segment/);
  });

  it('returns deep clones — mutating returned data does not leak into the store', async () => {
    const store = new MemoryWerewolfDecisionTraceStore();
    await store.appendDecisionTrace(sample({ traceId: 't-mut' }));
    const list1 = await store.listDecisionTraces('g-1');
    // Mutate a nested array on the returned trace. Without deep cloning,
    // the store's internal copy would observe this push.
    (list1[0]!.validActionTypes as unknown as string[]).push('hunter-shoot');
    const list2 = await store.listDecisionTraces('g-1');
    expect(list2[0]!.validActionTypes).toEqual(['day-vote']);
  });
});

describe('ObjectWerewolfDecisionTraceStore (over MemoryObjectStore)', () => {
  it('appends and lists traces, persisting through the object store', async () => {
    const objStore = new MemoryObjectStore();
    const store = new ObjectWerewolfDecisionTraceStore(objStore);
    await store.appendDecisionTrace(sample({ traceId: 't1' }));
    await store.appendDecisionTrace(sample({ traceId: 't2' }));
    expect(await objStore.exists('matches/g-1/decision-trace.jsonl')).toBe(true);
    const list = await store.listDecisionTraces('g-1');
    expect(list.map((t) => t.traceId)).toEqual(['t1', 't2']);
  });
});
