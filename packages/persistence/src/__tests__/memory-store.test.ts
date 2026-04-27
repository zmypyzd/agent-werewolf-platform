import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryTableStore, MemoryHandStore } from '../memory-store.js';
import type { TableState, HandSummary, ReplayEvent, TableConfig, BlindConfig } from '@agent-poker/shared';

function makeTable(tableId: string): TableState {
  const blindConfig: BlindConfig = { smallBlind: 25, bigBlind: 50, ante: 0 };
  const config: TableConfig = { tableId, name: 'Test', maxSeats: 6, blindConfig, defaultTimeoutMs: 5000 };
  return {
    tableId,
    config,
    status: 'preparing',
    seats: Array(6).fill(null) as null[],
    currentHandId: null,
    handNumber: 0,
    button: 0,
    createdAt: Date.now(),
  };
}

function makeHand(handId: string, tableId: string): HandSummary {
  return {
    handId,
    tableId,
    handNumber: 1,
    seed: 'seed-1',
    startedAt: Date.now(),
    completedAt: Date.now() + 1000,
    players: [],
    blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
    communityCards: [],
    allActions: [],
    results: [],
    finalPots: [],
  };
}

function makeEvent(handId: string, tableId: string, seq: number): ReplayEvent {
  return {
    eventId: `evt-${seq}`,
    handId,
    tableId,
    sequence: seq,
    eventType: 'test.event',
    timestamp: Date.now(),
    data: { seq },
  };
}

describe('MemoryTableStore', () => {
  let store: MemoryTableStore;
  beforeEach(() => { store = new MemoryTableStore(); });

  it('saveTable + getTable round-trip', async () => {
    const t = makeTable('tbl-1');
    await store.saveTable(t);
    const got = await store.getTable('tbl-1');
    expect(got).toEqual(t);
  });

  it('listTables returns all saved tables', async () => {
    await store.saveTable(makeTable('t1'));
    await store.saveTable(makeTable('t2'));
    const list = await store.listTables();
    expect(list).toHaveLength(2);
  });

  it('deleteTable removes from list', async () => {
    await store.saveTable(makeTable('t1'));
    await store.deleteTable('t1');
    const got = await store.getTable('t1');
    expect(got).toBeNull();
  });

  it('getTable returns null for unknown', async () => {
    expect(await store.getTable('nope')).toBeNull();
  });
});

describe('MemoryHandStore', () => {
  let store: MemoryHandStore;
  beforeEach(() => { store = new MemoryHandStore(); });

  it('saveHandSummary + getHandSummary round-trip', async () => {
    const h = makeHand('hand-1', 'tbl-1');
    await store.saveHandSummary(h);
    const got = await store.getHandSummary('hand-1');
    expect(got).toEqual(h);
  });

  it('listHandSummaries filters by tableId', async () => {
    await store.saveHandSummary(makeHand('h1', 'tbl-1'));
    await store.saveHandSummary(makeHand('h2', 'tbl-2'));
    await store.saveHandSummary(makeHand('h3', 'tbl-1'));
    const list = await store.listHandSummaries('tbl-1');
    expect(list).toHaveLength(2);
  });

  it('appendReplayEvent + getReplayEvents round-trip in order', async () => {
    await store.appendReplayEvent(makeEvent('hand-1', 'tbl-1', 1));
    await store.appendReplayEvent(makeEvent('hand-1', 'tbl-1', 0));
    await store.appendReplayEvent(makeEvent('hand-1', 'tbl-1', 2));
    const events = await store.getReplayEvents('hand-1');
    expect(events).toHaveLength(3);
    expect(events[0]!.sequence).toBe(0);
    expect(events[1]!.sequence).toBe(1);
    expect(events[2]!.sequence).toBe(2);
  });

  it('multiple appends return all events', async () => {
    for (let i = 0; i < 5; i++) {
      await store.appendReplayEvent(makeEvent('hand-1', 'tbl-1', i));
    }
    const events = await store.getReplayEvents('hand-1');
    expect(events).toHaveLength(5);
  });
});
