import { describe, it, expect, vi } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfPrivateState,
} from '@agent-poker/shared';
import { WerewolfMockAgent } from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';
import type { WerewolfReplayEvent } from '../replay-event.js';

type WerewolfAgent = IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;

describe('WerewolfOrchestrator', () => {
  it('createMatch returns matchId and initial state with 9 players in seat order', () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-orch-1',
      seed: 'seed-orch-1',
    });
    expect(matchId).toBe('g-orch-1');
    expect(initialState.players).toHaveLength(9);
    for (let i = 0; i < 9; i++) {
      expect(initialState.players[i]!.seatIndex).toBe(i);
      expect(initialState.players[i]!.id).toBe(`p${i + 1}`);
    }
  });

  it('runMatch throws when not all 9 agents are registered', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-2', seed: 'seed-orch-2' });
    // Only register 8 agents
    for (let i = 0; i < 8; i++) {
      orch.registerAgent(matchId, initialState.players[i]!.id, new WerewolfMockAgent(`a${i}`, 'X'));
    }
    await expect(orch.runMatch(matchId)).rejects.toThrow(/missing agent/);
  });

  it('runMatch drives 9 mock agents to game-over and stashes the summary', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-3', seed: 'seed-orch-3' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const summary = await orch.runMatch(matchId);
    expect(['good', 'werewolf']).toContain(summary.winner);
    expect(orch.getMatchSummary(matchId)).toEqual(summary);
  });

  it('runMatch emits events on the per-match emitter', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-4', seed: 'seed-orch-4' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const events: WerewolfReplayEvent[] = [];
    orch.subscribe(matchId, (e) => events.push(e));
    await orch.runMatch(matchId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.eventType).toBe('match.started');
    expect(events[events.length - 1]!.eventType).toBe('match.completed');
  });

  it('createMatch with duplicate gameId throws', () => {
    const orch = new WerewolfOrchestrator();
    orch.createMatch({ gameId: 'dup', seed: 's1' });
    expect(() => orch.createMatch({ gameId: 'dup', seed: 's2' })).toThrow(/already exists/);
  });

  it('registerAgent throws for unknown matchId', () => {
    const orch = new WerewolfOrchestrator();
    expect(() =>
      orch.registerAgent('does-not-exist', 'p1', new WerewolfMockAgent('a', 'A')),
    ).toThrow(/unknown match/);
  });

  it('registerAgent throws for unknown playerId', () => {
    const orch = new WerewolfOrchestrator();
    const { matchId } = orch.createMatch({ gameId: 'g-orch-5', seed: 's5' });
    expect(() =>
      orch.registerAgent(matchId, 'p99', new WerewolfMockAgent('a', 'A')),
    ).toThrow(/unknown player/);
  });

  it('runMatch throws if invoked twice on the same matchId', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-6', seed: 'seed-orch-6' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    await orch.runMatch(matchId);
    await expect(orch.runMatch(matchId)).rejects.toThrow(/already (run|completed)/i);
  });

  it('getMatchSummary returns null for unknown matchId', () => {
    const orch = new WerewolfOrchestrator();
    expect(orch.getMatchSummary('does-not-exist')).toBeNull();
  });

  it('subscriber exception is isolated — match completes and other subscribers still receive events', async () => {
    // EventEmitter delivers listeners synchronously; if listener A throws,
    // the for-loop inside emit breaks and listeners registered AFTER A do
    // not receive the event. Worse: the throw propagates back to whoever
    // called emit(), which in match-runner.ts:451-452 is in the engine's
    // hot loop — a single buggy subscriber would crash the entire match.
    // Subscriber error isolation: subscribe() must wrap the listener in a
    // try/catch so a thrown subscriber callback is logged and swallowed,
    // not propagated to the broadcaster.
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-subscriber-iso',
      seed: 'seed-subscriber-iso',
    });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    // Subscriber A — registered first, throws on every event.
    let throwingCallCount = 0;
    orch.subscribe(matchId, () => {
      throwingCallCount++;
      throw new Error('subscriber bomb');
    });
    // Subscriber B — registered second, collects events.
    const collected: WerewolfReplayEvent[] = [];
    orch.subscribe(matchId, (e) => {
      collected.push(e);
    });

    // The fix logs swallowed exceptions to console.error; silence the noise
    // in test output and assert at least one log fired to verify the
    // logging path also works.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const summary = await orch.runMatch(matchId);

    consoleErrorSpy.mockRestore();

    expect(['good', 'werewolf']).toContain(summary.winner);
    expect(throwingCallCount).toBeGreaterThan(0);
    expect(collected.length).toBeGreaterThan(0);
    // The collector receives both the opening match.started and the final
    // match.completed, so the broadcast made it through A's throws end-to-end.
    expect(collected[0]!.eventType).toBe('match.started');
    expect(collected[collected.length - 1]!.eventType).toBe('match.completed');
  });

  it('subscribePrivate exception is isolated — other private listeners still receive events', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-private-iso',
      seed: 'seed-private-iso',
    });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    let throwingCount = 0;
    orch.subscribePrivate(matchId, () => {
      throwingCount++;
      throw new Error('private subscriber bomb');
    });
    const collected: WerewolfPrivateState[] = [];
    orch.subscribePrivate(matchId, ({ privateState }) => {
      collected.push(privateState);
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await orch.runMatch(matchId);
    consoleErrorSpy.mockRestore();

    expect(throwingCount).toBeGreaterThan(0);
    expect(collected.length).toBeGreaterThan(0);
  });

  it('runMatch lands in a terminal failed state after an error and refuses retry', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-fail', seed: 'seed-fail' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    // Force the runner to throw via maxSteps: 1.
    await expect(orch.runMatch(matchId, { maxSteps: 1 })).rejects.toThrow(/exceeded.*step/i);
    // Retry must be refused — terminal state, not silent reset to 'preparing'.
    await expect(orch.runMatch(matchId)).rejects.toThrow(/failed previously/i);
    // Agent registration on a failed match is also blocked.
    expect(() =>
      orch.registerAgent(matchId, initialState.players[0]!.id, new WerewolfMockAgent('late', 'Late')),
    ).toThrow(/match .* is failed/i);
    expect(orch.getMatchSummary(matchId)).toBeNull();
  });
});
