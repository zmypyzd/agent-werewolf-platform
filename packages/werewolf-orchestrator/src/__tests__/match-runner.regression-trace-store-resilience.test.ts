import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { ArtifactLimitExceededError, type WerewolfDecisionTrace } from '@agent-poker/shared';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { IWerewolfDecisionTraceStore } from '@agent-poker/persistence';
import { WerewolfMatchRunner } from '../match-runner.js';

// Regression: a previous version of match-runner awaited
// recordWerewolfDecisionTrace() without a try/catch. If the underlying
// trace store rejected the write — legitimately, when the per-trace 8KB
// or per-match 1000-trace cap fires, or operationally, when Postgres
// returns a permission-denied error — the entire match aborted mid-
// action with the rejection bubbling out of runner.run(). That is the
// wrong tradeoff: decision traces are observability, not authoritative
// state. A long match must not collapse on the 1001st action because
// the trace cap fired. Wrap the call in try/catch + log; the next
// decision still attempts to persist.

class AlwaysFailingTraceStore implements IWerewolfDecisionTraceStore {
  public attempts = 0;
  async appendDecisionTrace(_t: WerewolfDecisionTrace): Promise<WerewolfDecisionTrace> {
    this.attempts++;
    throw new ArtifactLimitExceededError('synthetic cap trip for the test');
  }
  async listDecisionTraces(): Promise<WerewolfDecisionTrace[]> {
    return [];
  }
}

describe('WerewolfMatchRunner — decision trace store resilience', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('completes the match even when every appendDecisionTrace call throws', async () => {
    const initial = createGame({ gameId: 'g-resilience', seed: 'seed-resilience' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }),
      ]),
    );
    const failingStore = new AlwaysFailingTraceStore();
    const runner = new WerewolfMatchRunner(
      initial,
      agents,
      5_000,
      new EventEmitter(),
      { decisionTraceStore: failingStore },
    );

    // Match must complete successfully — no rejection should escape run().
    const summary = await runner.run();
    expect(summary.stepCount).toBeGreaterThan(0);
    expect(['good', 'werewolf']).toContain(summary.winner);

    // Every action attempted to record a trace, every write failed.
    expect(failingStore.attempts).toBe(summary.stepCount);

    // Each failure surfaced via console.error so ops can see them in logs.
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls.length).toBe(summary.stepCount);
    // Spot-check the message format — includes matchId and sequence so
    // an operator can grep for a specific decision.
    const firstCall = consoleErrorSpy.mock.calls[0]?.[0] as string;
    expect(firstCall).toMatch(/g-resilience/);
    expect(firstCall).toMatch(/seq=/);
  });
});
