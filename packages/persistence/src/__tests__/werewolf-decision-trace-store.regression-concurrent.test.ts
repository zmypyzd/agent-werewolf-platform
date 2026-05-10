import { describe, expect, it } from 'vitest';
import type { WerewolfDecisionTrace } from '@agent-poker/shared';
import { MemoryObjectStore } from '../object-store.js';
import {
  MemoryWerewolfDecisionTraceStore,
  ObjectWerewolfDecisionTraceStore,
} from '../werewolf-decision-trace-store.js';

// Regression: ObjectWerewolfDecisionTraceStore.appendDecisionTrace performed
// a classic read-modify-write across two awaits with no concurrency primitive:
//
//   const existing = await this.listDecisionTraces(matchId);  // ← read
//   const next = [...existing, publicTrace];
//   assertWithinLimits(publicTrace, next, this.limits);
//   await this.objectStore.putText({ key, body: serialize(next), ... }); // ← write
//
// Two concurrent calls for the same matchId both read `existing`, both compute
// `next`, both write — the second write silently overwrites the first, dropping
// one trace forever. Within the current orchestrator the match-runner already
// awaits each recordWerewolfDecisionTrace so calls inside one match are
// serialized, but the IWerewolfDecisionTraceStore contract makes no such
// promise. A future change that parallelizes trace recording (e.g. moving it
// off the hot path via `void appendDecisionTrace(...).catch(...)`, or splitting
// match-runner into per-phase workers sharing one matchId) would silently
// introduce data loss. HANDOFF.md §5 flagged this as "needs concurrency
// primitive, not a tactical fix."
//
// Pin the contract: appendDecisionTrace must be atomic under concurrent calls
// for the same matchId. The Memory variant already is (no awaits inside).
// The Object variant gets a per-matchId promise-chain mutex.

const sample = (overrides: Partial<WerewolfDecisionTrace> = {}): WerewolfDecisionTrace => ({
  traceId: 't',
  matchId: 'g-concurrent',
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

describe('Werewolf decision-trace store — concurrent appendDecisionTrace', () => {
  it('MemoryWerewolfDecisionTraceStore: 10 concurrent appends preserve every trace', async () => {
    const store = new MemoryWerewolfDecisionTraceStore();
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.appendDecisionTrace(sample({ traceId: `t${i}`, sequence: i })),
      ),
    );
    const list = await store.listDecisionTraces('g-concurrent');
    expect(list.map((t) => t.traceId).sort()).toEqual(
      Array.from({ length: N }, (_, i) => `t${i}`).sort(),
    );
  });

  it('ObjectWerewolfDecisionTraceStore: 10 concurrent appends preserve every trace', async () => {
    // This is the load-bearing assertion — prior to the per-matchId mutex,
    // this test FAILS deterministically because the read-modify-write window
    // lets every concurrent caller observe the same `existing` snapshot and
    // each subsequent write clobbers all but the last.
    const store = new ObjectWerewolfDecisionTraceStore(new MemoryObjectStore());
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.appendDecisionTrace(sample({ traceId: `t${i}`, sequence: i })),
      ),
    );
    const list = await store.listDecisionTraces('g-concurrent');
    expect(list.map((t) => t.traceId).sort()).toEqual(
      Array.from({ length: N }, (_, i) => `t${i}`).sort(),
    );
  });

  it('ObjectWerewolfDecisionTraceStore: concurrent appends to DIFFERENT matchIds do not block each other', async () => {
    // Forward-looking: the fix uses a per-matchId mutex, NOT a global one.
    // Independent matches must remain parallelizable so a slow match doesn't
    // back up trace recording on every other match running on the server.
    const store = new ObjectWerewolfDecisionTraceStore(new MemoryObjectStore());
    await Promise.all([
      store.appendDecisionTrace(sample({ matchId: 'match-A', traceId: 'A1', sequence: 0 })),
      store.appendDecisionTrace(sample({ matchId: 'match-A', traceId: 'A2', sequence: 1 })),
      store.appendDecisionTrace(sample({ matchId: 'match-B', traceId: 'B1', sequence: 0 })),
      store.appendDecisionTrace(sample({ matchId: 'match-B', traceId: 'B2', sequence: 1 })),
    ]);

    const a = await store.listDecisionTraces('match-A');
    const b = await store.listDecisionTraces('match-B');
    expect(a.map((t) => t.traceId).sort()).toEqual(['A1', 'A2']);
    expect(b.map((t) => t.traceId).sort()).toEqual(['B1', 'B2']);
  });
});
