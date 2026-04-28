import { describe, expect, it } from 'vitest';
import type { HandSummary, ReplayEvent } from '../lib/matchArtifacts.js';
import {
  buildActionTimeline,
  buildDistributionRows,
  buildHandReplayViews,
  filterActionTimelineByStreet,
  formatCard,
  formatCountLabel,
  formatNullableMs,
  formatNullablePercent,
  getNextActionId,
  getPreviousActionId,
  resolveActiveReplayStreetFilter,
  resolveSelectedStreetFilter,
  type ActionTimelineItem,
} from '../lib/matchReplayView.js';

const hand: HandSummary = {
  handId: 'hand-1',
  tableId: 'tbl-1',
  handNumber: 1,
  seed: 'seed-1',
  startedAt: 1,
  completedAt: 100,
  players: [
    {
      playerId: 'bot-a',
      agentId: 'agent-a',
      seatIndex: 0,
      stackBefore: 1000,
      stackAfter: 950,
    },
    {
      playerId: 'bot-b',
      agentId: 'agent-b',
      seatIndex: 1,
      stackBefore: 1000,
      stackAfter: 1150,
    },
  ],
  blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
  communityCards: [
    { rank: 'A', suit: 's' },
    { rank: 'K', suit: 'h' },
    { rank: 'Q', suit: 'd' },
  ],
  allActions: [
    {
      actionId: 'action-1',
      handId: 'hand-1',
      playerId: 'bot-a',
      phase: 'preflop',
      actionType: 'call',
      amount: 50,
      stackAfter: 950,
      sequence: 0,
      timestamp: 10,
    },
    {
      actionId: 'action-2',
      handId: 'hand-1',
      playerId: 'bot-b',
      phase: 'flop',
      actionType: 'raise',
      amount: 150,
      stackAfter: 1150,
      sequence: 1,
      timestamp: 20,
    },
  ],
  results: [
    { playerId: 'bot-a', seatIndex: 0, potIndex: 0, winAmount: 0, netChange: -50 },
    { playerId: 'bot-b', seatIndex: 1, potIndex: 0, winAmount: 200, netChange: 150 },
  ],
  finalPots: [{ amount: 200, eligiblePlayerIds: ['bot-b'] }],
};

const events: ReplayEvent[] = [
  {
    eventId: 'event-1',
    handId: 'hand-1',
    tableId: 'tbl-1',
    sequence: 1,
    eventType: 'player_action',
    timestamp: 1,
    data: { phase: 'preflop' },
  },
  {
    eventId: 'event-2',
    handId: 'hand-1',
    tableId: 'tbl-1',
    sequence: 2,
    eventType: 'player_action',
    timestamp: 2,
    data: { street: 'flop' },
  },
  {
    eventId: 'event-3',
    handId: 'hand-2',
    tableId: 'tbl-1',
    sequence: 3,
    eventType: 'player_action',
    timestamp: 3,
    data: { phase: 'turn' },
  },
];

const timeline: ActionTimelineItem[] = [
  {
    id: 'hand-1:0',
    eventId: 'event-1',
    ordinal: 1,
    playerId: 'bot-a',
    actionType: 'call',
    amount: 50,
    street: 'preflop',
    eventType: 'action.applied',
  },
  {
    id: 'hand-1:1',
    eventId: 'event-2',
    ordinal: 2,
    playerId: 'bot-b',
    actionType: 'check',
    amount: 0,
    street: 'flop',
    eventType: 'action.applied',
  },
  {
    id: 'hand-1:2',
    eventId: 'event-3',
    ordinal: 3,
    playerId: 'bot-a',
    actionType: 'bet',
    amount: 100,
    street: 'flop',
    eventType: 'action.applied',
  },
  {
    id: 'hand-1:3',
    eventId: 'event-4',
    ordinal: 4,
    playerId: 'bot-b',
    actionType: 'fold',
    amount: 0,
    street: null,
    eventType: 'action.applied',
  },
];

describe('match replay view helpers', () => {
  it('formats public cards and count labels', () => {
    expect(formatCard({ rank: 'A', suit: 's' })).toBe('AS');
    expect(formatCard({ rank: 'T', suit: 'c' })).toBe('TC');
    expect(formatCountLabel('pot_control')).toBe('pot control');
  });

  it('formats nullable metric values', () => {
    expect(formatNullableMs(null)).toBe('n/a');
    expect(formatNullableMs(12.6)).toBe('13 ms');
    expect(formatNullablePercent(null)).toBe('n/a');
    expect(formatNullablePercent(0.427)).toBe('43%');
  });

  it('builds hand rail summaries from public hand data and replay events', () => {
    const views = buildHandReplayViews([hand], events);

    expect(views).toEqual([{
      handId: 'hand-1',
      handNumber: 1,
      seed: 'seed-1',
      actionCount: 2,
      eventCount: 2,
      communityCardCount: 3,
      biggestNetChange: 150,
    }]);
  });

  it('builds action timeline rows with inferred public street context', () => {
    const timeline = buildActionTimeline(hand, events);

    expect(timeline).toEqual([
      {
        id: 'hand-1:0',
        eventId: null,
        ordinal: 1,
        playerId: 'bot-a',
        actionType: 'call',
        amount: 50,
        street: 'preflop',
        eventType: null,
      },
      {
        id: 'hand-1:1',
        eventId: null,
        ordinal: 2,
        playerId: 'bot-b',
        actionType: 'raise',
        amount: 150,
        street: 'flop',
        eventType: null,
      },
    ]);
  });

  it('uses public action phase and applied events for timeline context despite clutter', () => {
    const timeline = buildActionTimeline({
      ...hand,
      allActions: [{
        actionId: 'action-1',
        handId: 'hand-1',
        playerId: 'bot-a',
        phase: 'turn',
        actionType: 'bet',
        amount: 75,
        stackAfter: 925,
        sequence: 0,
        timestamp: 10,
      }],
    }, [
      {
        eventId: 'event-started',
        handId: 'hand-1',
        tableId: 'tbl-1',
        sequence: 1,
        eventType: 'hand.started',
        timestamp: 9,
        data: { handNumber: 1 },
      },
      {
        eventId: 'event-received',
        handId: 'hand-1',
        tableId: 'tbl-1',
        sequence: 2,
        eventType: 'action.received',
        timestamp: 11,
        data: { actionType: 'bet', amount: 75 },
      },
      {
        eventId: 'event-applied',
        handId: 'hand-1',
        tableId: 'tbl-1',
        sequence: 3,
        eventType: 'action.applied',
        timestamp: 12,
        data: { actionId: 'action-1', phase: 'river', sequence: 5 },
      },
    ]);

    expect(timeline).toEqual([{
      id: 'hand-1:0',
      eventId: 'event-applied',
      ordinal: 1,
      playerId: 'bot-a',
      actionType: 'bet',
      amount: 75,
      street: 'turn',
      eventType: 'action.applied',
    }]);
  });

  it('falls back to chronological applied events instead of round-local action sequence', () => {
    const timeline = buildActionTimeline({
      ...hand,
      allActions: [
        {
          actionId: 'missing-event-action-1',
          handId: 'hand-1',
          playerId: 'bot-a',
          phase: 'preflop',
          actionType: 'call',
          amount: 50,
          stackAfter: 950,
          sequence: 0,
          timestamp: 10,
        },
        {
          actionId: 'missing-event-action-2',
          handId: 'hand-1',
          playerId: 'bot-b',
          phase: 'flop',
          actionType: 'raise',
          amount: 150,
          stackAfter: 850,
          sequence: 0,
          timestamp: 20,
        },
      ],
    }, [
      {
        eventId: 'event-applied-preflop',
        handId: 'hand-1',
        tableId: 'tbl-1',
        sequence: 1,
        eventType: 'action.applied',
        timestamp: 11,
        data: { phase: 'preflop', sequence: 0 },
      },
      {
        eventId: 'event-applied-flop',
        handId: 'hand-1',
        tableId: 'tbl-1',
        sequence: 2,
        eventType: 'action.applied',
        timestamp: 21,
        data: { phase: 'flop', sequence: 3 },
      },
    ]);

    expect(timeline[1]).toMatchObject({
      eventId: 'event-applied-flop',
      playerId: 'bot-b',
      actionType: 'raise',
      street: 'flop',
      eventType: 'action.applied',
    });
  });

  it('reserves exact actionId matches before chronological fallback', () => {
    const timeline = buildActionTimeline({
      ...hand,
      allActions: [
        {
          actionId: 'missing-event-action',
          handId: 'hand-1',
          playerId: 'bot-a',
          phase: 'preflop',
          actionType: 'call',
          amount: 50,
          stackAfter: 950,
          sequence: 0,
          timestamp: 10,
        },
        {
          actionId: 'action-2',
          handId: 'hand-1',
          playerId: 'bot-b',
          phase: 'flop',
          actionType: 'raise',
          amount: 150,
          stackAfter: 850,
          sequence: 1,
          timestamp: 20,
        },
      ],
    }, [
      {
        eventId: 'event-action-2',
        handId: 'hand-1',
        tableId: 'tbl-1',
        sequence: 1,
        eventType: 'action.applied',
        timestamp: 21,
        data: { actionId: 'action-2', phase: 'flop', sequence: 1 },
      },
      {
        eventId: 'event-unmatched',
        handId: 'hand-1',
        tableId: 'tbl-1',
        sequence: 2,
        eventType: 'action.applied',
        timestamp: 11,
        data: { actionId: 'unmatched-action', phase: 'preflop', sequence: 0 },
      },
    ]);

    expect(timeline.map(item => item.eventId)).toEqual([
      'event-unmatched',
      'event-action-2',
    ]);
  });

  it('sorts distribution rows by count and computes percentages', () => {
    expect(buildDistributionRows({ fold: 1, call: 3, raise: 2 })).toEqual([
      { label: 'call', count: 3, percent: 0.5 },
      { label: 'raise', count: 2, percent: 1 / 3 },
      { label: 'fold', count: 1, percent: 1 / 6 },
    ]);
  });

  it('gets previous and next action ids within the selected street filter', () => {
    expect(getPreviousActionId(timeline, 'hand-1:2')).toBe('hand-1:1');
    expect(getNextActionId(timeline, 'hand-1:1')).toBe('hand-1:2');
    expect(getPreviousActionId(timeline, 'hand-1:2', 'flop')).toBe('hand-1:1');
    expect(getNextActionId(timeline, 'hand-1:1', 'flop')).toBe('hand-1:2');
    expect(getPreviousActionId(timeline, 'hand-1:1', 'flop')).toBeNull();
    expect(getNextActionId(timeline, 'hand-1:2', 'flop')).toBeNull();
  });

  it('returns null for previous and next when the selected action is stale', () => {
    expect(getPreviousActionId(timeline, 'missing')).toBeNull();
    expect(getNextActionId(timeline, null)).toBeNull();
  });

  it('resolves selected street filters and filters timeline actions', () => {
    expect(resolveSelectedStreetFilter('flop')).toBe('flop');
    expect(resolveSelectedStreetFilter('all')).toBe('all');
    expect(resolveSelectedStreetFilter('bogus')).toBe('all');
    expect(resolveSelectedStreetFilter(null)).toBe('all');
    expect(resolveActiveReplayStreetFilter('flop', 'hand-2', 'hand-1')).toBe('all');
    expect(resolveActiveReplayStreetFilter('flop', 'hand-1', 'hand-1')).toBe('flop');
    expect(filterActionTimelineByStreet(timeline, 'all').map(action => action.id)).toEqual([
      'hand-1:0',
      'hand-1:1',
      'hand-1:2',
      'hand-1:3',
    ]);
    expect(filterActionTimelineByStreet(timeline, 'flop').map(action => action.id)).toEqual([
      'hand-1:1',
      'hand-1:2',
    ]);
    expect(filterActionTimelineByStreet(timeline, 'river')).toEqual([]);
  });
});
