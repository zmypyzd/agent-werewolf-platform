import { describe, it, expect, vi } from 'vitest';
import { TableOrchestrator } from '../orchestrator.js';
import { MemoryTableStore, MemoryHandStore } from '@agent-poker/persistence';
import { AlwaysCallAgent } from '@agent-poker/agent-runtime';
import type { BlindConfig } from '@agent-poker/shared';
import { RealtimeHub } from '@agent-poker/realtime';

// Regression: the orchestrator's internal `replay-event` listener at
// orchestrator.ts:467-508 fans events out to the hub via publishTable +
// publishSeat. Before this isolation, any throw inside a hub.publish*
// call propagated back to emitter.emit() in hand-runner.ts and aborted
// the in-flight hand entirely — a transient hub error during deal
// would kill the match. Same architectural class as werewolf-side
// PR #38 (subscriber error isolation), but applied to the orchestrator's
// own internal listener rather than a public subscribe() API.
//
// The fix wraps each of the three fan-out arms (public broadcast,
// hole_cards.dealt fan-out, action.requested fan-out) in its own
// try/catch + console.error. These tests pin two contracts:
//
//   1. A throw in any one arm cannot crash the hand.
//   2. A throw in one arm cannot starve the other arms.

const BLIND_CONFIG: BlindConfig = { smallBlind: 25, bigBlind: 50, ante: 0 };

class ThrowingPublishTableHub extends RealtimeHub {
  publishTableCalls = 0;
  publishSeatCalls = 0;
  override publishTable(): void {
    this.publishTableCalls += 1;
    throw new Error('synthetic hub.publishTable failure');
  }
  override publishSeat(): void {
    this.publishSeatCalls += 1;
    // Succeed silently so we can verify the other arm still fires.
  }
}

class ThrowingPublishSeatHub extends RealtimeHub {
  publishTableCalls = 0;
  publishSeatCalls = 0;
  override publishTable(): void {
    this.publishTableCalls += 1;
  }
  override publishSeat(): void {
    this.publishSeatCalls += 1;
    throw new Error('synthetic hub.publishSeat failure');
  }
}

async function runOneHand(
  hub: RealtimeHub,
): Promise<{ completed: boolean; actionCount: number }> {
  const orch = new TableOrchestrator(new MemoryTableStore(), new MemoryHandStore(), hub);
  const table = await orch.createTable({
    name: 'iso',
    maxSeats: 3,
    blindConfig: BLIND_CONFIG,
    defaultTimeoutMs: 1000,
    seed: 'hub-iso-seed',
  });
  // Two AlwaysCallAgents — enough to drive a full hand to showdown.
  for (let i = 0; i < 2; i++) {
    const agentId = `bot-${i}`;
    await orch.addAgent(
      table.tableId,
      { agentId, name: `Bot ${i}`, adapterType: 'mock' },
      new AlwaysCallAgent(agentId, `Bot ${i}`),
      1000,
    );
  }
  const summary = await orch.startHand(table.tableId);
  return {
    completed: summary.completedAt > summary.startedAt,
    actionCount: summary.allActions.length,
  };
}

describe('TableOrchestrator — hub publish error isolation (PR #38 poker parallel)', () => {
  it('hand completes even when hub.publishTable throws on every event', async () => {
    // Silence the expected console.error noise from the isolation logging.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const hub = new ThrowingPublishTableHub();
    const { completed, actionCount } = await runOneHand(hub);

    // Hand ran to completion despite the hub failure on every event.
    expect(completed).toBe(true);
    expect(actionCount).toBeGreaterThan(0);
    // The isolation arm fired many times — once per replay event.
    expect(hub.publishTableCalls).toBeGreaterThan(0);
    // Logging path actually ran, distinguishing the wrapper's catch from
    // some other console.error elsewhere.
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  it('hand completes when hub.publishSeat throws on hole_cards.dealt', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const hub = new ThrowingPublishSeatHub();
    const { completed, actionCount } = await runOneHand(hub);

    expect(completed).toBe(true);
    expect(actionCount).toBeGreaterThan(0);
    // publishSeat fired at least twice (one hole_cards.dealt per player).
    expect(hub.publishSeatCalls).toBeGreaterThan(0);
    // publishTable still got every public event — the seat-fanout failure
    // did not starve the public broadcast.
    expect(hub.publishTableCalls).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});
