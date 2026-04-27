import { describe, it, expect } from 'vitest';
import { TableOrchestrator } from '../orchestrator.js';
import { MemoryHandStore, MemoryTableStore } from '@agent-poker/persistence';
import { AlwaysCallAgent } from '@agent-poker/agent-runtime';
import type { BlindConfig } from '@agent-poker/shared';
import { ForbiddenError, HandInProgressError, NotFoundError, SeatTakenError } from '@agent-poker/shared';

const BLINDS: BlindConfig = { smallBlind: 25, bigBlind: 50, ante: 0 };

async function freshOrch() {
  const orch = new TableOrchestrator(new MemoryTableStore(), new MemoryHandStore());
  return orch;
}

async function tableForOwner(orch: TableOrchestrator, owner: string) {
  return orch.createTable(
    { name: 'T', maxSeats: 4, blindConfig: BLINDS, defaultTimeoutMs: 100, seed: 'own-seed' },
    owner,
  );
}

async function seat(orch: TableOrchestrator, tableId: string, agentId: string, ownerUserId: string) {
  return orch.addAgent(
    tableId,
    { agentId, name: agentId, adapterType: 'mock' },
    new AlwaysCallAgent(agentId, agentId),
    1000,
    { ownerUserId, adapterType: 'mock' },
  );
}

describe('TableOrchestrator: ownership checks', () => {
  it('a new table starts in status "preparing"', async () => {
    const orch = await freshOrch();
    const table = await tableForOwner(orch, 'usr-alice');
    expect(table.status).toBe('preparing');
  });

  it('SeatInfo carries ownerUserId, adapterType, joinedAt, sitOutNextHand', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    const s = await seat(orch, t.tableId, 'a-1', 'usr-alice');
    expect(s.ownerUserId).toBe('usr-alice');
    expect(s.adapterType).toBe('mock');
    expect(s.sitOutNextHand).toBe(false);
    expect(s.joinedAt).toBeGreaterThan(0);
  });

  it('user A cannot remove user B\'s seat (ForbiddenError)', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    await seat(orch, t.tableId, 'bot-alice', 'usr-alice');
    await seat(orch, t.tableId, 'bot-bob', 'usr-bob');

    await expect(orch.removeAgent(t.tableId, 'bot-bob', 'usr-alice')).rejects.toBeInstanceOf(ForbiddenError);
    // The seat is still there:
    const fresh = await orch.getTable(t.tableId);
    expect(fresh.seats.find(s => s?.agentId === 'bot-bob')).toBeTruthy();
  });

  it('an owner can remove their own seat', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    await seat(orch, t.tableId, 'bot-bob', 'usr-bob');
    await orch.removeAgent(t.tableId, 'bot-bob', 'usr-bob');
    const fresh = await orch.getTable(t.tableId);
    expect(fresh.seats.find(s => s?.agentId === 'bot-bob')).toBeUndefined();
  });

  it('legacy callers without callerUserId still bypass the check (orchestrator-internal use)', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    await seat(orch, t.tableId, 'bot-bob', 'usr-bob');
    await orch.removeAgent(t.tableId, 'bot-bob');
    const fresh = await orch.getTable(t.tableId);
    expect(fresh.seats.find(s => s?.agentId === 'bot-bob')).toBeUndefined();
  });

  it('assertSeatOwnedBy returns the seat for the owner and throws ForbiddenError otherwise', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    const placed = await seat(orch, t.tableId, 'bot-alice', 'usr-alice');
    const got = orch.assertSeatOwnedBy(t.tableId, placed.seatIndex, 'usr-alice');
    expect(got.agentId).toBe('bot-alice');
    expect(() => orch.assertSeatOwnedBy(t.tableId, placed.seatIndex, 'usr-bob')).toThrow(ForbiddenError);
  });

  it('assertSeatOwnedBy on an empty seat throws NotFoundError', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    expect(() => orch.assertSeatOwnedBy(t.tableId, 0, 'usr-alice')).toThrow(NotFoundError);
  });

  it('addAgent rejects out-of-range seatIndex', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    await expect(seatAtIndex(orch, t.tableId, 'a', 'usr-alice', 99)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('addAgent rejects an already-taken seatIndex', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    await seatAtIndex(orch, t.tableId, 'a', 'usr-alice', 1);
    await expect(seatAtIndex(orch, t.tableId, 'b', 'usr-bob', 1)).rejects.toBeInstanceOf(SeatTakenError);
  });
});

describe('TableOrchestrator: status state machine', () => {
  it('preparing → in_hand → paused (≥2 seats remain)', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    await seat(orch, t.tableId, 'a', 'usr-a');
    await seat(orch, t.tableId, 'b', 'usr-b');
    expect((await orch.getTable(t.tableId)).status).toBe('preparing');

    await orch.startHand(t.tableId);
    const after = await orch.getTable(t.tableId);
    expect(after.status).toBe('paused');
  });

  it('hand-end with <2 surviving seats drops status back to preparing', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    // bust-out: one seat starts with stack 0 simulated by zero-stack agent? Easier: seat 2, mark sitOutNextHand on one.
    await seat(orch, t.tableId, 'a', 'usr-a');
    const seatB = await seat(orch, t.tableId, 'b', 'usr-b');
    // Force the orchestrator's busted-cleanup path by mutating sitOutNextHand on the live table state.
    const fresh = await orch.getTable(t.tableId);
    fresh.seats[seatB.seatIndex] = { ...fresh.seats[seatB.seatIndex]!, sitOutNextHand: true };
    await orch.startHand(t.tableId);
    expect((await orch.getTable(t.tableId)).status).toBe('preparing');
  });

  it('startHand on an in_hand table is impossible (sequential)', async () => {
    // The synchronous hand model means there is never a moment where startHand
    // runs concurrently; but if a hand is in progress conceptually, a second
    // startHand must reject. Simulate by flipping handInProgress via an addAgent
    // attempt during in_hand status.
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    await seat(orch, t.tableId, 'a', 'usr-a');
    await seat(orch, t.tableId, 'b', 'usr-b');
    // Simulate by pretending the hand is mid-flight: addAgent during `in_hand`.
    const fresh = await orch.getTable(t.tableId);
    fresh.status = 'in_hand';
    await expect(seat(orch, t.tableId, 'c', 'usr-c')).rejects.toBeInstanceOf(HandInProgressError);
  });

  it('closeTable transitions a table to status "completed" and only the owner may call it', async () => {
    const orch = await freshOrch();
    const t = await tableForOwner(orch, 'usr-alice');
    await expect(orch.closeTable(t.tableId, 'usr-bob')).rejects.toBeInstanceOf(ForbiddenError);
    const closed = await orch.closeTable(t.tableId, 'usr-alice');
    expect(closed.status).toBe('completed');
  });
});

async function seatAtIndex(
  orch: TableOrchestrator,
  tableId: string,
  agentId: string,
  ownerUserId: string,
  seatIndex: number,
) {
  return orch.addAgent(
    tableId,
    { agentId, name: agentId, adapterType: 'mock' },
    new AlwaysCallAgent(agentId, agentId),
    1000,
    { ownerUserId, adapterType: 'mock' },
    seatIndex,
  );
}
