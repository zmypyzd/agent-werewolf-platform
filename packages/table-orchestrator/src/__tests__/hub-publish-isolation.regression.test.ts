import { describe, it, expect, vi } from 'vitest';
import { TableOrchestrator } from '../orchestrator.js';
import { MemoryTableStore, MemoryHandStore } from '@agent-poker/persistence';
import { AlwaysCallAgent } from '@agent-poker/agent-runtime';
import type { BlindConfig } from '@agent-poker/shared';
import { RealtimeHub } from '@agent-poker/realtime';

// Regression: TableOrchestrator fans replay-events out through the hub
// from two layers — the in-listener handler attached to the per-hand
// emitter, and direct callers at addAgent / removeAgent / addSpectator /
// removeSpectator / createTable (the publishLobbyUpdate path) /
// the in-listener fan-out arms. Before this isolation, any throw inside
// any hub.publish* call propagated back through whatever was calling
// it — `emitter.emit()` for the in-listener path, or directly to the
// route handler for the direct callers — and either aborted the
// in-flight hand or left state mutated while the caller saw an error
// (partial commit on addAgent / removeAgent / lobby-update).
//
// Same architectural class as werewolf-orchestrator PR #38, applied to
// the table-orchestrator's own internal listener AND extended to every
// direct hub.publish* call-site. These tests pin three contracts:
//
//   1. A throw in publishTable cannot crash the hand or addAgent.
//   2. A throw in publishSeat cannot starve the publishTable arm.
//   3. A throw in publishLobby (called from createTable / addAgent /
//      removeAgent / addSpectator / removeSpectator) cannot leave the
//      caller seeing an error even though the state mutation succeeded.

const BLIND_CONFIG: BlindConfig = { smallBlind: 25, bigBlind: 50, ante: 0 };

class ThrowingPublishTableHub extends RealtimeHub {
  publishTableCalls = 0;
  publishSeatCalls = 0;
  publishLobbyCalls = 0;
  override publishTable(): void {
    this.publishTableCalls += 1;
    throw new Error('synthetic hub.publishTable failure');
  }
  override publishSeat(): void {
    this.publishSeatCalls += 1;
    // Succeed silently so we can verify the other arm still fires.
  }
  override publishLobby(): void {
    this.publishLobbyCalls += 1;
    // Pass-through for this fixture.
  }
}

class ThrowingPublishSeatHub extends RealtimeHub {
  publishTableCalls = 0;
  publishSeatCalls = 0;
  publishLobbyCalls = 0;
  override publishTable(): void {
    this.publishTableCalls += 1;
  }
  override publishSeat(): void {
    this.publishSeatCalls += 1;
    throw new Error('synthetic hub.publishSeat failure');
  }
  override publishLobby(): void {
    this.publishLobbyCalls += 1;
  }
}

// Throws on EVERY publish method. Pins the broadest contract: even when
// publishLobby is also broken (the gap the earlier version of this fix
// missed — TableOrchestrator.publishLobbyUpdate called the raw hub from
// 5 different state-mutating paths), addAgent / startHand still succeed
// from the caller's perspective.
class FullyThrowingHub extends RealtimeHub {
  publishTableCalls = 0;
  publishSeatCalls = 0;
  publishLobbyCalls = 0;
  override publishTable(): void {
    this.publishTableCalls += 1;
    throw new Error('synthetic hub.publishTable failure');
  }
  override publishSeat(): void {
    this.publishSeatCalls += 1;
    throw new Error('synthetic hub.publishSeat failure');
  }
  override publishLobby(): void {
    this.publishLobbyCalls += 1;
    throw new Error('synthetic hub.publishLobby failure');
  }
}

// Returns a rejected Promise from publishTable. RealtimeHub.publishTable
// is typed `void`, but the subclass extension model that the fixtures
// above demonstrate means a future hub implementation could surface
// async failures (e.g., a hub that buffers to Redis). Pure sync
// try/catch wouldn't catch a rejected Promise — `isThenable` does.
// Mirrors the async-rejection guard added to werewolf-orchestrator
// PR #38's safeListener.
class AsyncRejectingHub extends RealtimeHub {
  publishTableCalls = 0;
  override publishTable(): void {
    this.publishTableCalls += 1;
    // The signature is `void`, but TypeScript allows a Promise here
    // because Promise<void> is assignable to void. Cast away the type
    // to make the intent explicit.
    return Promise.reject(new Error('synthetic async hub.publishTable rejection')) as unknown as void;
  }
}

async function buildOrchAndTable(
  hub: RealtimeHub,
): Promise<{ orch: TableOrchestrator; tableId: string }> {
  const orch = new TableOrchestrator(new MemoryTableStore(), new MemoryHandStore(), hub);
  const table = await orch.createTable({
    name: 'iso',
    maxSeats: 3,
    blindConfig: BLIND_CONFIG,
    defaultTimeoutMs: 1000,
    seed: 'hub-iso-seed',
  });
  return { orch, tableId: table.tableId };
}

async function runOneHand(
  hub: RealtimeHub,
): Promise<{ completed: boolean; actionCount: number }> {
  const { orch, tableId } = await buildOrchAndTable(hub);
  // Two AlwaysCallAgents — enough to drive a full hand to showdown.
  for (let i = 0; i < 2; i++) {
    const agentId = `bot-${i}`;
    await orch.addAgent(
      tableId,
      { agentId, name: `Bot ${i}`, adapterType: 'mock' },
      new AlwaysCallAgent(agentId, `Bot ${i}`),
      1000,
    );
  }
  const summary = await orch.startHand(tableId);
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

  it('addAgent / startHand / removeAgent succeed against a hub that throws on every publish method', async () => {
    // Pins the broadest direct-caller contract: createTable,
    // publishLobbyUpdate (via addAgent / removeAgent), and the
    // in-listener fan-out all route through the safe* helpers, so
    // a hub that throws on EVERY publish method cannot bubble back
    // to the caller. The earlier version of this fix passed the
    // existing two tests but left publishLobby unprotected — this
    // test would have caught that gap.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const hub = new FullyThrowingHub();
    const { orch, tableId } = await buildOrchAndTable(hub);

    // Each of these calls invokes publishLobby (via publishLobbyUpdate)
    // and either publishTable directly or publishSeat via the listener.
    await expect(
      orch.addAgent(
        tableId,
        { agentId: 'bot-0', name: 'Bot 0', adapterType: 'mock' },
        new AlwaysCallAgent('bot-0', 'Bot 0'),
        1000,
      ),
    ).resolves.toBeDefined();
    await expect(
      orch.addAgent(
        tableId,
        { agentId: 'bot-1', name: 'Bot 1', adapterType: 'mock' },
        new AlwaysCallAgent('bot-1', 'Bot 1'),
        1000,
      ),
    ).resolves.toBeDefined();

    const summary = await orch.startHand(tableId);
    // `toBeGreaterThanOrEqual` (not `toBeGreaterThan`) because the whole
    // hand runs synchronously against in-memory stores + mock agents,
    // and Date.now() resolves to millisecond granularity — startedAt and
    // completedAt frequently land in the same millisecond. The contract
    // we want to pin is "the hand finished after starting", not "the
    // hand took at least 1ms"; that the function resolved at all + has
    // a non-empty allActions list (asserted below) is the real signal.
    expect(summary.completedAt).toBeGreaterThanOrEqual(summary.startedAt);
    expect(summary.allActions.length).toBeGreaterThan(0);

    // Every safe helper rerouted the throw through console.error.
    expect(hub.publishTableCalls).toBeGreaterThan(0);
    expect(hub.publishSeatCalls).toBeGreaterThan(0);
    expect(hub.publishLobbyCalls).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  it('async-rejecting publishTable does not surface as unhandled rejection', async () => {
    // RealtimeHub.publishTable is typed `void`, but if a subclass returns
    // a Promise (Promise<void> is assignable to void), a pure sync
    // try/catch would miss its rejection — it would surface as an
    // UnhandledPromiseRejection at the Node event loop. The safe*
    // helpers' isThenable guard attaches a .catch so the rejection is
    // captured by console.error like any other failure.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const hub = new AsyncRejectingHub();
    const { orch, tableId } = await buildOrchAndTable(hub);

    await expect(
      orch.addAgent(
        tableId,
        { agentId: 'bot-async', name: 'Bot Async', adapterType: 'mock' },
        new AlwaysCallAgent('bot-async', 'Bot Async'),
        1000,
      ),
    ).resolves.toBeDefined();

    // Flush the microtask queue so the .catch on the rejected Promise
    // fires before we assert.
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(hub.publishTableCalls).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});
