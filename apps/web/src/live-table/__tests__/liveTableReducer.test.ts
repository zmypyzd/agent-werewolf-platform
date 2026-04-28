import { describe, expect, it } from 'vitest';
import { createInitialLiveTableState, liveTableReducer } from '../liveTableReducer.js';
import type { Card, LiveTableEvent, TableSnapshot } from '../liveTableTypes.js';

const cards: [Card, Card] = [
  { rank: 'A', suit: 's' },
  { rank: 'K', suit: 'h' },
];

const snapshot: TableSnapshot = {
  tableId: 'tbl-1',
  config: {
    name: 'Demo Table',
    maxSeats: 6,
    blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
    defaultTimeoutMs: 1000,
  },
  status: 'preparing',
  seats: [
    {
      seatIndex: 0,
      agentId: 'agent-a',
      playerId: 'player-a',
      stack: 1000,
      status: 'active',
      ownerUserId: 'usr-a',
      adapterType: 'human',
      agentConfigId: null,
      sitOutNextHand: false,
      joinedAt: 1,
    },
    {
      seatIndex: 1,
      agentId: 'agent-b',
      playerId: 'player-b',
      stack: 1000,
      status: 'active',
      ownerUserId: 'usr-b',
      adapterType: 'mock',
      agentConfigId: null,
      sitOutNextHand: false,
      joinedAt: 1,
    },
    null,
    null,
    null,
    null,
  ],
  currentHandId: null,
  handNumber: 0,
  button: 0,
};

function reduce(events: LiveTableEvent[]) {
  return events.reduce(liveTableReducer, createInitialLiveTableState());
}

describe('liveTableReducer', () => {
  it('initializes seats from a table snapshot', () => {
    const state = reduce([{ type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' }]);

    expect(state.tableId).toBe('tbl-1');
    expect(state.tableName).toBe('Demo Table');
    expect(state.seats).toHaveLength(6);
    expect(state.seats[0]).toMatchObject({
      occupied: true,
      playerId: 'player-a',
      agentId: 'agent-a',
      stack: 1000,
      isMe: true,
      isButton: true,
      holeCards: null,
    });
    expect(state.seats[2]).toMatchObject({ occupied: false, seatIndex: 2 });
  });

  it('resets hand state on hand.started', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      {
        type: 'table.hole_cards_revealed',
        handId: 'hand-old',
        playerId: 'player-a',
        seatIndex: 0,
        agentId: 'agent-a',
        holeCards: cards,
      },
      { type: 'community_cards.dealt', phase: 'flop', cards: [{ rank: 'Q', suit: 'd' }] },
      { type: 'hand.started', handId: 'hand-1', handNumber: 1 },
    ]);

    expect(state.handId).toBe('hand-1');
    expect(state.phase).toBe('preflop');
    expect(state.board).toEqual([]);
    expect(state.pots).toEqual([]);
    expect(state.actionLog).toEqual([]);
    expect(state.pendingAction).toBeNull();
    expect(state.seats[0]!.holeCards).toBeNull();
  });

  it('stores spectator-visible hole cards on the matching seat', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      { type: 'hand.started', handId: 'hand-1', handNumber: 1 },
      {
        type: 'table.hole_cards_revealed',
        handId: 'hand-1',
        playerId: 'player-b',
        seatIndex: 1,
        agentId: 'agent-b',
        holeCards: cards,
      },
    ]);

    expect(state.seats[1]!.holeCards).toEqual(cards);
    expect(state.seats[0]!.holeCards).toBeNull();
  });

  it('sets pending action only from private seat action requests', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      {
        type: 'seat.action_requested',
        handId: 'hand-1',
        requestId: 'req-1',
        deadlineAt: 1234,
        legalActions: [{ type: 'fold' }, { type: 'call', callAmount: 50 }],
        privateState: { playerId: 'player-a', holeCards: cards },
      },
    ]);

    expect(state.pendingAction).toMatchObject({
      handId: 'hand-1',
      requestId: 'req-1',
      legalActions: [{ type: 'fold' }, { type: 'call', callAmount: 50 }],
    });
    expect(state.seats[0]!.holeCards).toEqual(cards);
  });

  it('updates board, pots, current actor, and action log from live events', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      { type: 'hand.started', handId: 'hand-1', handNumber: 1 },
      { type: 'action.requested', playerId: 'player-b' },
      { type: 'community_cards.dealt', phase: 'flop', cards: [{ rank: 'Q', suit: 'd' }] },
      { type: 'betting_round.complete', pots: [{ amount: 150 }] },
      { type: 'action.applied', playerId: 'player-b', actionType: 'raise', amount: 100, potTotal: 150 },
      { type: 'pot.awarded', amount: 150, winnerIds: ['player-b'] },
    ]);

    expect(state.currentActorPlayerId).toBeNull();
    expect(state.board).toEqual([{ rank: 'Q', suit: 'd' }]);
    expect(state.phase).toBe('flop');
    expect(state.pots).toEqual([{ amount: 150 }]);
    expect(state.actionLog.map(entry => entry.label)).toEqual([
      'player-b raise 100 (pot 150)',
      'pot awarded 150 to player-b',
    ]);
  });
});
