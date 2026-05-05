import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfGameState,
} from '@agent-poker/shared';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMockAgent } from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import { WerewolfMatchRunner } from '../match-runner.js';
import type { WerewolfReplayEvent } from '../replay-event.js';

type WerewolfAgent = IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;

function buildAgents(state: WerewolfGameState): Map<string, WerewolfAgent> {
  const m = new Map<string, WerewolfAgent>();
  for (const p of state.players) {
    m.set(p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
  }
  return m;
}

describe('WerewolfMatchRunner', () => {
  it('runs a complete 9-AI match to game-over and produces a summary', async () => {
    const initial = createGame({ gameId: 'g-runner-1', seed: 'seed-runner-1' });
    const agents = buildAgents(initial);
    const emitter = new EventEmitter();
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);

    const summary = await runner.run();

    expect(['good', 'werewolf']).toContain(summary.winner);
    expect(summary.gameId).toBe('g-runner-1');
    expect(summary.seed).toBe('seed-runner-1');
    expect(summary.finalPlayers).toHaveLength(9);
    expect(summary.replayEventCount).toBeGreaterThan(0);
    expect(summary.stepCount).toBeGreaterThan(0);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('emits replay events with monotonically increasing sequence', async () => {
    const initial = createGame({ gameId: 'g-runner-2', seed: 'seed-runner-2' });
    const agents = buildAgents(initial);
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));

    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.sequence).toBe(events[i - 1]!.sequence + 1);
    }
    expect(events[0]!.eventType).toBe('match.started');
    expect(events[events.length - 1]!.eventType).toBe('match.completed');
  });

  it('emits agent.action_requested before agent.action_received for each step', async () => {
    const initial = createGame({ gameId: 'g-runner-3', seed: 'seed-runner-3' });
    const agents = buildAgents(initial);
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    const requested = events.filter((e) => e.eventType === 'agent.action_requested');
    const received = events.filter((e) => e.eventType === 'agent.action_received');
    expect(requested.length).toBe(received.length);
    expect(requested.length).toBe(events.filter((e) => e.eventType === 'engine.action_applied').length);
  });

  it('emits agent.timeout when an agent stalls (deterministic via fake timers)', async () => {
    vi.useFakeTimers();
    try {
      const initial = createGame({ gameId: 'g-runner-4', seed: 'seed-runner-4' });
      const agents = buildAgents(initial);
      // Replace one agent with a stalling agent — only on the very first request.
      const stallerId = initial.players[0]!.id;
      let stalledOnce = false;
      const realAgent = agents.get(stallerId)!;
      const stallAgent: WerewolfAgent = {
        agentId: 'staller',
        name: 'Staller',
        requestDecision(req) {
          if (!stalledOnce) {
            stalledOnce = true;
            return new Promise<WerewolfDecisionResponse>(() => {
              // never resolves — only the TimeoutHandler's fake-timer fallback
              // can settle this request.
            });
          }
          return realAgent.requestDecision(req);
        },
      };
      agents.set(stallerId, stallAgent);

      const emitter = new EventEmitter();
      const events: WerewolfReplayEvent[] = [];
      emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
      // Long virtual timeout — fake timers control when the fallback fires.
      const runner = new WerewolfMatchRunner(initial, agents, 30_000, emitter);
      const runPromise = runner.run();

      // Drain all queued fake timers + microtasks until the run completes.
      // Subsequent agent calls return synchronously, so their per-call
      // setTimeouts get cleared before they fire.
      await vi.runAllTimersAsync();
      await runPromise;

      const timeouts = events.filter((e) => e.eventType === 'agent.timeout');
      expect(timeouts.length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes a Zod-schema-invalid agent response into agent.invalid_action with schemaFailure flag', async () => {
    const initial = createGame({ gameId: 'g-runner-schema', seed: 'seed-runner-schema' });
    const agents = new Map<string, WerewolfAgent>();
    // One leaky agent that returns a malformed action — type missing entirely.
    const malformedAgent: WerewolfAgent = {
      agentId: 'malformed',
      name: 'Malformed',
      async requestDecision(req) {
        return {
          requestId: req.requestId,
          agentId: 'malformed',
          // Cast through unknown so TS lets us simulate a runtime-only violation.
          action: { foo: 'bar' } as unknown as WerewolfDecisionResponse['action'],
        };
      },
    };
    for (const p of initial.players) {
      agents.set(p.id, p.id === initial.players[0]!.id ? malformedAgent : new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    const invalids = events.filter((e) => e.eventType === 'agent.invalid_action');
    expect(invalids.length).toBeGreaterThanOrEqual(1);
    const schemaFailures = invalids.filter((e) => (e.data as { schemaFailure?: boolean }).schemaFailure === true);
    expect(schemaFailures.length).toBeGreaterThanOrEqual(1);
    // Reason text mentions schema validation, not just shape mismatch.
    expect((schemaFailures[0]!.data as { reason: string }).reason).toMatch(/schema validation/);
  });

  it('throws when an agent is missing for a player at start', async () => {
    const initial = createGame({ gameId: 'g-runner-5', seed: 'seed-runner-5' });
    const agents = buildAgents(initial);
    agents.delete(initial.players[3]!.id);
    const emitter = new EventEmitter();
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await expect(runner.run()).rejects.toThrow(/missing agent/);
  });

  it('throws when stepCount exceeds maxSteps', async () => {
    const initial = createGame({ gameId: 'g-runner-6', seed: 'seed-runner-6' });
    const agents = buildAgents(initial);
    const emitter = new EventEmitter();
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter, { maxSteps: 1 });
    await expect(runner.run()).rejects.toThrow(/exceeded.*step/i);
  });

  it('throws when run() is invoked a second time on the same instance', async () => {
    const initial = createGame({ gameId: 'g-runner-rerun', seed: 'seed-runner-rerun' });
    const agents = buildAgents(initial);
    const emitter = new EventEmitter();
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();
    await expect(runner.run()).rejects.toThrow(/already invoked/i);
  });

  it('publicState passed to agents never contains role-assigned or night-action history entries', async () => {
    const initial = createGame({ gameId: 'g-runner-7', seed: 'seed-runner-7' });
    const seenRequests: WerewolfDecisionRequest[] = [];
    const agents = new Map<string, WerewolfAgent>();
    for (const p of initial.players) {
      const inner = new WerewolfMockAgent(`agent-${p.id}`, p.name);
      agents.set(p.id, {
        agentId: inner.agentId,
        name: inner.name,
        async requestDecision(req) {
          seenRequests.push(req);
          return inner.requestDecision(req);
        },
      });
    }
    const emitter = new EventEmitter();
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    expect(seenRequests.length).toBeGreaterThan(0);
    for (const req of seenRequests) {
      const types = req.publicState.history.map((e) => (e as { type: string }).type);
      expect(types).not.toContain('role-assigned');
      expect(types).not.toContain('night-action');
      // privateState.selfId must equal the player whose turn it is.
      expect(req.privateState.selfId).toBe(req.playerId);
    }
  });
});
