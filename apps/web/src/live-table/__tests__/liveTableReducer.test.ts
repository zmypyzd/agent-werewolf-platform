import { describe, expect, it } from 'vitest';
import { createInitialLiveTableState, liveTableReducer } from '../liveTableReducer.js';
import { normalizeLiveTableEvent } from '../normalizeLiveTableEvent.js';
import type { Card, LiveTableEvent, TableSnapshot } from '../liveTableTypes.js';
import type { WsMessage } from '../../lib/ws.js';

const cards: [Card, Card] = [
  { rank: 'A', suit: 's' },
  { rank: 'K', suit: 'h' },
];

const otherCards: [Card, Card] = [
  { rank: '8', suit: 'c' },
  { rank: '8', suit: 'd' },
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

const sharedOwnerSnapshot: TableSnapshot = {
  ...snapshot,
  seats: [
    snapshot.seats[0]!,
    {
      ...snapshot.seats[1]!,
      ownerUserId: 'usr-a',
    },
    null,
    null,
    null,
    null,
  ],
};

function reduce(events: LiveTableEvent[]) {
  return events.reduce(liveTableReducer, createInitialLiveTableState());
}

function message(type: string, payload: Record<string, unknown>): WsMessage {
  return { topic: 'table:tbl-1', type, payload };
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
        type: 'seat.hole_cards',
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

  it('stores private hole cards on the matching seat', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      { type: 'hand.started', handId: 'hand-1', handNumber: 1 },
      {
        type: 'seat.hole_cards',
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

  it('preserves revealed hole cards when a same-hand snapshot refresh arrives', () => {
    const activeSnapshot: TableSnapshot = {
      ...snapshot,
      status: 'in_hand',
      currentHandId: 'hand-1',
      handNumber: 1,
      seats: [
        { ...snapshot.seats[0]!, stack: 950 },
        { ...snapshot.seats[1]!, stack: 1050 },
        null,
        null,
        null,
        null,
      ],
    };
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      { type: 'hand.started', handId: 'hand-1', handNumber: 1 },
      {
        type: 'seat.hole_cards',
        handId: 'hand-1',
        playerId: 'player-a',
        seatIndex: 0,
        agentId: 'agent-a',
        holeCards: cards,
      },
      {
        type: 'seat.hole_cards',
        handId: 'hand-1',
        playerId: 'player-b',
        seatIndex: 1,
        agentId: 'agent-b',
        holeCards: otherCards,
      },
      { type: 'snapshot.loaded', table: activeSnapshot, meUserId: 'usr-a' },
    ]);

    expect(state.seats[0]!).toMatchObject({ stack: 950, holeCards: cards });
    expect(state.seats[1]!).toMatchObject({ stack: 1050, holeCards: otherCards });
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

  it('updates private action cards only on the matching player seat', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: sharedOwnerSnapshot, meUserId: 'usr-a' },
      {
        type: 'seat.action_requested',
        handId: 'hand-1',
        requestId: 'req-1',
        deadlineAt: 1234,
        legalActions: [{ type: 'fold' }, { type: 'call', callAmount: 50 }],
        privateState: { playerId: 'player-b', holeCards: cards },
      },
    ]);

    expect(state.seats[0]!.isMe).toBe(true);
    expect(state.seats[1]!.isMe).toBe(true);
    expect(state.seats[0]!.holeCards).toBeNull();
    expect(state.seats[1]!.holeCards).toEqual(cards);
  });

  it('updates private hole cards only on the identified seat', () => {
    const privateEvent = normalizeLiveTableEvent(message('seat.hole_cards', {
      handId: 'hand-1',
      playerId: 'player-b',
      seatIndex: 1,
      agentId: 'agent-b',
      holeCards: cards,
    }));

    expect(privateEvent).not.toBeNull();
    const state = reduce([
      { type: 'snapshot.loaded', table: sharedOwnerSnapshot, meUserId: 'usr-a' },
      privateEvent!,
    ]);

    expect(state.seats[0]!.isMe).toBe(true);
    expect(state.seats[1]!.isMe).toBe(true);
    expect(state.seats[0]!.holeCards).toBeNull();
    expect(state.seats[1]!.holeCards).toEqual(cards);
  });

  it('preserves the current hand id when hand.started omits handId', () => {
    const started = normalizeLiveTableEvent(message('hand.started', { handNumber: 7 }));

    expect(started).toEqual({ type: 'hand.started', handNumber: 7 });
    const state = reduce([
      {
        type: 'snapshot.loaded',
        table: { ...snapshot, currentHandId: 'hand-from-snapshot' },
        meUserId: 'usr-a',
      },
      started!,
    ]);

    expect(state.handId).toBe('hand-from-snapshot');
  });

  it('uses a private hole-card hand id when no current hand id exists', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      {
        type: 'seat.hole_cards',
        handId: 'hand-from-reveal',
        playerId: 'player-b',
        seatIndex: 1,
        agentId: 'agent-b',
        holeCards: cards,
      },
    ]);

    expect(state.handId).toBe('hand-from-reveal');
    expect(state.seats[1]!.holeCards).toEqual(cards);
  });

  it('ignores stale or mismatched private hole-card frames', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      { type: 'hand.started', handId: 'hand-1', handNumber: 1 },
      {
        type: 'seat.hole_cards',
        handId: 'hand-old',
        playerId: 'player-b',
        seatIndex: 1,
        agentId: 'agent-b',
        holeCards: cards,
      },
      {
        type: 'seat.hole_cards',
        handId: 'hand-1',
        playerId: 'player-b',
        seatIndex: 0,
        agentId: 'agent-b',
        holeCards: otherCards,
      },
    ]);

    expect(state.seats[0]!.holeCards).toBeNull();
    expect(state.seats[1]!.holeCards).toBeNull();
  });

  it('ignores public table-topic hole-card payloads from the normalizer', () => {
    const publicReveal = normalizeLiveTableEvent(message('table.hole_cards_revealed', {
      handId: 'hand-1',
      playerId: 'player-b',
      seatIndex: 1,
      agentId: 'agent-b',
      holeCards: cards,
    }));

    expect(publicReveal).toBeNull();
  });

  it('clears a pending action when that player action is applied', () => {
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
      { type: 'action.applied', playerId: 'player-a', actionType: 'call', amount: 50, potTotal: 100 },
    ]);

    expect(state.pendingAction).toBeNull();
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
    expect(state.actionLog.map(entry => entry.id)).toEqual(['log-0', 'log-1']);
  });

  it('keeps the live pot display and completion log current during a hand', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      { type: 'hand.started', handId: 'hand-1', handNumber: 1 },
      { type: 'action.applied', playerId: 'player-b', actionType: 'call', amount: 50, potTotal: 75 },
      { type: 'hand.completed' },
    ]);

    expect(state.pots).toEqual([{ amount: 75 }]);
    expect(state.actionLog.map(entry => entry.label)).toEqual([
      'player-b call 50 (pot 75)',
      'hand completed',
    ]);
  });
});

describe('normalizeLiveTableEvent', () => {
  it('returns null for non-record payloads', () => {
    expect(normalizeLiveTableEvent({
      topic: 'table:tbl-1',
      type: 'action.requested',
      payload: null as unknown as Record<string, unknown>,
    })).toBeNull();
    expect(normalizeLiveTableEvent({
      topic: 'table:tbl-1',
      type: 'action.requested',
      payload: [] as unknown as Record<string, unknown>,
    })).toBeNull();
  });

  it('returns null for malformed required fields', () => {
    expect(normalizeLiveTableEvent(message('action.requested', { playerId: '' }))).toBeNull();
    expect(normalizeLiveTableEvent(message('action.applied', {
      playerId: 'player-a',
      actionType: 'jam',
      amount: 50,
    }))).toBeNull();
    expect(normalizeLiveTableEvent(message('community_cards.dealt', {
      phase: 'banana',
      cards: [{ rank: 'Q', suit: 'd' }],
    }))).toBeNull();
    expect(normalizeLiveTableEvent(message('pot.awarded', {
      amount: 'not-a-number',
      winnerIds: ['player-b'],
    }))).toBeNull();
  });
});
