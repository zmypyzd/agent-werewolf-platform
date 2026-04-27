import type { TableState, HandSummary, ReplayEvent, TableConfig, BlindConfig } from '@agent-poker/shared';

export function makeTable(tableId: string): TableState {
  const blindConfig: BlindConfig = { smallBlind: 25, bigBlind: 50, ante: 0 };
  const config: TableConfig = {
    tableId,
    name: `T-${tableId}`,
    maxSeats: 6,
    blindConfig,
    defaultTimeoutMs: 5000,
  };
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

export function makeHand(handId: string, tableId: string, completedAt = Date.now()): HandSummary {
  return {
    handId,
    tableId,
    handNumber: 1,
    seed: 'seed-1',
    startedAt: completedAt - 1000,
    completedAt,
    players: [],
    blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
    communityCards: [],
    allActions: [],
    results: [],
    finalPots: [],
  };
}

export function makeEvent(handId: string, tableId: string, seq: number): ReplayEvent {
  return {
    eventId: `evt-${handId}-${seq}`,
    handId,
    tableId,
    sequence: seq,
    eventType: 'test.event',
    timestamp: Date.now(),
    data: { seq },
  };
}
