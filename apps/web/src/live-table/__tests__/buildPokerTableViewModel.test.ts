import { describe, expect, it } from 'vitest';
import { buildPokerTableViewModel } from '../buildPokerTableViewModel.js';
import type { LiveTableViewState } from '../liveTableTypes.js';

const baseState: LiveTableViewState = {
  tableId: 'tbl-1',
  tableName: 'Demo Table',
  status: 'in_hand',
  blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
  handId: 'hand-1',
  handNumber: 3,
  phase: 'flop',
  buttonSeatIndex: 0,
  seats: [
    {
      seatIndex: 0,
      occupied: true,
      playerId: 'p0',
      agentId: 'a0',
      ownerUserId: 'u0',
      adapterType: 'human',
      stack: 900,
      status: 'active',
      isButton: true,
      isCurrentActor: false,
      isMe: true,
      holeCards: [
        { rank: 'A', suit: 's' },
        { rank: 'K', suit: 'h' },
      ],
    },
    {
      seatIndex: 1,
      occupied: true,
      playerId: 'p1',
      agentId: 'a1',
      ownerUserId: 'u1',
      adapterType: 'mock',
      stack: 1100,
      status: 'active',
      isButton: false,
      isCurrentActor: true,
      isMe: false,
      holeCards: [
        { rank: '8', suit: 'c' },
        { rank: '8', suit: 'd' },
      ],
    },
    {
      seatIndex: 2,
      occupied: false,
      playerId: null,
      agentId: null,
      ownerUserId: null,
      adapterType: null,
      stack: null,
      status: null,
      isButton: false,
      isCurrentActor: false,
      isMe: false,
      holeCards: null,
    },
    {
      seatIndex: 3,
      occupied: false,
      playerId: null,
      agentId: null,
      ownerUserId: null,
      adapterType: null,
      stack: null,
      status: null,
      isButton: false,
      isCurrentActor: false,
      isMe: false,
      holeCards: null,
    },
  ],
  board: [{ rank: 'Q', suit: 'd' }],
  pots: [{ amount: 150 }, { amount: 75 }],
  currentActorPlayerId: 'p1',
  actionLog: [{ id: '1', label: 'p1 raise 100' }],
  pendingAction: null,
  connectionStatus: 'connected',
};

describe('buildPokerTableViewModel', () => {
  it('derives table labels, pot total, visible hands, and actor state', () => {
    const model = buildPokerTableViewModel(baseState, { seatable: true });

    expect(model.title).toBe('Demo Table');
    expect(model.subtitle).toBe('hand hand-1 · flop · blinds 25/50');
    expect(model.phaseLabel).toBe('flop');
    expect(model.totalPot).toBe(225);
    expect(model.seats[0]!.position).toBe('top-left');
    expect(model.seats[1]!.position).toBe('top-right');
    expect(model.seats[0]!.displayName).toBe('a0');
    expect(model.seats[1]!.isCurrentActor).toBe(true);
    expect(model.visibleHands.map(hand => hand.playerId)).toEqual(['p0', 'p1']);
    expect(model.visibleHands[0]!.cards).toHaveLength(2);
    expect(model.canShowSeatControls).toBe(true);
  });

  it('derives stable identity, adapter, you, actor, and dealer labels for occupied seats', () => {
    const state: LiveTableViewState = {
      ...baseState,
      seats: baseState.seats.map((seat, index) => index === 2 ? {
        seatIndex: 2,
        occupied: true,
        playerId: 'p2',
        agentId: 'http-agent-2',
        ownerUserId: 'u2',
        adapterType: 'http',
        stack: 1200,
        status: 'waiting',
        isButton: false,
        isCurrentActor: false,
        isMe: false,
        holeCards: null,
      } : seat),
    };

    const model = buildPokerTableViewModel(state, { seatable: true });

    expect(model.seats[0]).toMatchObject({
      identityLabel: 'a0',
      adapterLabel: 'Human',
      isYou: true,
      isButton: true,
      isCurrentActor: false,
    });
    expect(model.seats[1]).toMatchObject({
      identityLabel: 'a1',
      adapterLabel: 'Mock Agent',
      isYou: false,
      isButton: false,
      isCurrentActor: true,
    });
    expect(model.seats[2]).toMatchObject({
      identityLabel: 'http-agent-2',
      adapterLabel: 'HTTP Agent',
      isYou: false,
      isButton: false,
      isCurrentActor: false,
    });
    expect(model.seats[3]).toMatchObject({
      occupied: false,
      identityLabel: 'Seat 4',
      adapterLabel: null,
      isYou: false,
    });
  });

  it('uses cards pending labels for occupied seats without revealed cards', () => {
    const state: LiveTableViewState = {
      ...baseState,
      seats: baseState.seats.map((seat, index) => index === 1 ? { ...seat, holeCards: null } : seat),
    };

    const model = buildPokerTableViewModel(state, { seatable: false });

    expect(model.visibleHands.find(hand => hand.playerId === 'p1')!.cards).toBeNull();
    expect(model.visibleHands.find(hand => hand.playerId === 'p1')!.cardStatus).toBe('cards pending');
    expect(model.canShowSeatControls).toBe(false);
  });

  it('maps supported table sizes to stable seat positions', () => {
    expect(positionsFor(2)).toEqual(['top-left', 'bottom-right']);
    expect(positionsFor(3)).toEqual(['top-left', 'right', 'bottom-left']);
    expect(positionsFor(4)).toEqual(['top-left', 'top-right', 'bottom-right', 'bottom-left']);
    expect(positionsFor(5)).toEqual(['top-left', 'top-right', 'right', 'bottom-right', 'bottom-left']);
    expect(positionsFor(6)).toEqual([
      'top-left',
      'top-right',
      'right',
      'bottom-right',
      'bottom-left',
      'left',
    ]);
    expect(new Set(positionsFor(7)).size).toBe(7);
    expect(new Set(positionsFor(8)).size).toBe(8);
    expect(new Set(positionsFor(9)).size).toBe(9);
  });

  it('uses no-active-hand labels and no visible hand rows before cards are dealt', () => {
    const state: LiveTableViewState = {
      ...baseState,
      status: 'preparing',
      handId: null,
      handNumber: 0,
      phase: null,
      board: [],
      pots: [],
      seats: baseState.seats.map((seat, index) => ({
        ...seat,
        holeCards: index === 0 ? seat.holeCards : null,
      })),
    };

    const model = buildPokerTableViewModel(state, { seatable: true });

    expect(model.subtitle).toBe('no active hand · waiting · blinds 25/50');
    expect(model.visibleHands).toEqual([]);
  });
});

function positionsFor(seatCount: number) {
  const state: LiveTableViewState = {
    ...baseState,
    seats: Array.from({ length: seatCount }, (_, seatIndex) => ({
      seatIndex,
      occupied: false,
      playerId: null,
      agentId: null,
      ownerUserId: null,
      adapterType: null,
      stack: null,
      status: null,
      isButton: false,
      isCurrentActor: false,
      isMe: false,
      holeCards: null,
    })),
  };

  return buildPokerTableViewModel(state, { seatable: false }).seats.map(seat => seat.position);
}
