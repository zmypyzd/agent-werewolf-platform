import { describe, it, expect } from 'vitest';
import { TableOrchestrator } from '../orchestrator.js';
import { MemoryHandStore, MemoryTableStore } from '@agent-poker/persistence';
import { AlwaysCallAgent } from '@agent-poker/agent-runtime';
import type { BlindConfig, SeatInfo } from '@agent-poker/shared';
import { SeatTakenError, NotFoundError } from '@agent-poker/shared';

// Regression: pins the atomicity of seat mutations in TableOrchestrator
// against the werewolf #15 race shape (`fix(werewolf-lobby-registry):
// close race in inviteAgent — re-check seat after await`).
//
// Why this test exists even though no race is currently observable:
//
//   The poker orchestrator's addAgent / removeAgent / leaveSeat methods
//   commit their seat mutations SYNCHRONOUSLY before any await:
//
//     orchestrator.ts:220   tableState.seats[targetIdx] = seatInfo;
//     orchestrator.ts:226   await this.tableStore.saveTable(tableState);
//
//   Node's event loop runs that sync block atomically, so two concurrent
//   addAgent calls for the same empty seat cannot both pass the line-191
//   `tableState.seats[seatIndex] !== null` check — the second one runs
//   after the first has already mutated the in-memory tableState.
//
//   Werewolf had the inverse shape (await BEFORE the write at
//   werewolf-lobby-registry.ts:414 in pre-#15 code), and PR #15 fixed it
//   with a post-await re-check. If a future poker refactor moves the seat
//   write AFTER an await — e.g. an async ownership-or-balance lookup
//   between line 197 (target chosen) and line 220 (write) — the race
//   shape silently appears. This test asserts the safety property at the
//   contract level so that refactor breaks the build immediately.

const BLINDS: BlindConfig = { smallBlind: 25, bigBlind: 50, ante: 0 };

async function freshOrch(): Promise<TableOrchestrator> {
  return new TableOrchestrator(new MemoryTableStore(), new MemoryHandStore());
}

async function tableForOwner(orch: TableOrchestrator, owner: string) {
  return orch.createTable(
    { name: 'T', maxSeats: 4, blindConfig: BLINDS, defaultTimeoutMs: 100, seed: 'concurrent-seed' },
    owner,
  );
}

function addAgentCall(
  orch: TableOrchestrator,
  tableId: string,
  agentId: string,
  ownerUserId: string,
  seatIndex?: number,
): Promise<SeatInfo> {
  return orch.addAgent(
    tableId,
    { agentId, name: agentId, adapterType: 'mock' },
    new AlwaysCallAgent(agentId, agentId),
    1000,
    { ownerUserId, adapterType: 'mock' },
    seatIndex,
  );
}

describe('TableOrchestrator concurrency — seat mutations are atomic', () => {
  it('two concurrent addAgent calls for the same explicit seatIndex: one wins, the other gets SeatTakenError', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-host');

    const results = await Promise.allSettled([
      addAgentCall(orch, t.tableId, 'bot-A', 'usr-A', 0),
      addAgentCall(orch, t.tableId, 'bot-B', 'usr-B', 0),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SeatTakenError);

    // Post-condition: the seat holds exactly one of the two agents, and the
    // other never appears anywhere in the seats array (i.e. the loser was
    // not silently placed elsewhere).
    const fresh = await orch.getTable(t.tableId);
    const seat0 = fresh.seats[0];
    expect(seat0).not.toBeNull();
    expect(['bot-A', 'bot-B']).toContain(seat0!.agentId);

    const winnerId = seat0!.agentId;
    const loserId = winnerId === 'bot-A' ? 'bot-B' : 'bot-A';
    expect(fresh.seats.some((s) => s?.agentId === loserId)).toBe(false);
  });

  it('two concurrent addAgent calls without seatIndex: both succeed in distinct empty seats', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-host');

    const results = await Promise.all([
      addAgentCall(orch, t.tableId, 'bot-A', 'usr-A'),
      addAgentCall(orch, t.tableId, 'bot-B', 'usr-B'),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]!.seatIndex).not.toBe(results[1]!.seatIndex);

    const fresh = await orch.getTable(t.tableId);
    const occupiedAgentIds = fresh.seats.filter((s) => s !== null).map((s) => s!.agentId);
    expect(new Set(occupiedAgentIds)).toEqual(new Set(['bot-A', 'bot-B']));
  });

  it('two concurrent removeAgent calls for the same agent: one removes, the other surfaces NotFoundError', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-host');
    await addAgentCall(orch, t.tableId, 'bot-A', 'usr-A', 0);

    const results = await Promise.allSettled([
      orch.removeAgent(t.tableId, 'bot-A', 'usr-A'),
      orch.removeAgent(t.tableId, 'bot-A', 'usr-A'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(NotFoundError);

    const fresh = await orch.getTable(t.tableId);
    expect(fresh.seats.every((s) => s?.agentId !== 'bot-A')).toBe(true);
  });

  it('a fully-saturated table fails the concurrent N+1 add with TableFullError-or-SeatTaken (never silently overwrites)', async () => {
    // The 4-seat table is filled in advance. The N+1 concurrent attempt
    // must not stomp on any existing seat.
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-host');
    await addAgentCall(orch, t.tableId, 'bot-1', 'usr-1');
    await addAgentCall(orch, t.tableId, 'bot-2', 'usr-2');
    await addAgentCall(orch, t.tableId, 'bot-3', 'usr-3');
    await addAgentCall(orch, t.tableId, 'bot-4', 'usr-4');
    const before = await orch.getTable(t.tableId);
    expect(before.seats.filter((s) => s !== null)).toHaveLength(4);
    const beforeIds = before.seats.map((s) => s!.agentId);

    const results = await Promise.allSettled([
      addAgentCall(orch, t.tableId, 'bot-overflow-1', 'usr-X'),
      addAgentCall(orch, t.tableId, 'bot-overflow-2', 'usr-Y'),
    ]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);

    const after = await orch.getTable(t.tableId);
    expect(after.seats.map((s) => s!.agentId)).toEqual(beforeIds);
  });
});
