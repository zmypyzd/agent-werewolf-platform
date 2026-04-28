import type { WsMessage } from '../lib/ws.js';
import type { ActionType, Card, HandPhase, LegalAction, LivePotView, LiveTableEvent } from './liveTableTypes.js';

const ACTION_TYPES = new Set<ActionType>(['fold', 'check', 'call', 'bet', 'raise', 'all-in']);
const HAND_PHASES = new Set<HandPhase>(['preflop', 'flop', 'turn', 'river', 'showdown', 'complete']);
const RANKS = new Set<Card['rank']>(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);
const SUITS = new Set<Card['suit']>(['c', 'd', 'h', 's']);

export function normalizeLiveTableEvent(message: WsMessage): LiveTableEvent | null {
  const data = message.payload;

  switch (message.type) {
    case 'hand.started':
      return {
        type: 'hand.started',
        handId: stringValue(data['handId']),
        handNumber: numberValue(data['handNumber']),
      };
    case 'table.hole_cards_revealed': {
      const holeCards = data['holeCards'];
      if (!isTwoCards(holeCards)) return null;

      return {
        type: 'table.hole_cards_revealed',
        handId: stringValue(data['handId']),
        playerId: stringValue(data['playerId']),
        seatIndex: numberValue(data['seatIndex'], -1),
        agentId: stringValue(data['agentId']),
        holeCards,
      };
    }
    case 'seat.hole_cards': {
      const holeCards = data['holeCards'];
      if (!isTwoCards(holeCards)) return null;

      return {
        type: 'seat.hole_cards',
        handId: stringValue(data['handId']),
        holeCards,
      };
    }
    case 'community_cards.dealt':
      return {
        type: 'community_cards.dealt',
        phase: handPhaseValue(data['phase']),
        cards: cardArrayValue(data['cards']),
      };
    case 'action.requested':
      return { type: 'action.requested', playerId: stringValue(data['playerId']) };
    case 'seat.action_requested': {
      const privateState = privateStateValue(data['privateState']);
      if (!privateState) return null;

      return {
        type: 'seat.action_requested',
        handId: stringValue(data['handId']),
        requestId: stringValue(data['requestId']),
        legalActions: legalActionsValue(data['legalActions']),
        deadlineAt: numberValue(data['deadlineAt']),
        privateState,
      };
    }
    case 'action.applied': {
      const actionType = actionTypeValue(data['actionType']) ?? 'check';
      const potTotal = optionalNumberValue(data['potTotal']);
      const event = {
        type: 'action.applied' as const,
        playerId: stringValue(data['playerId']),
        actionType,
        amount: numberValue(data['amount']),
      };

      return potTotal === undefined ? event : { ...event, potTotal };
    }
    case 'betting_round.complete':
      return {
        type: 'betting_round.complete',
        pots: potsValue(data['pots']),
      };
    case 'pot.awarded':
      return {
        type: 'pot.awarded',
        amount: numberValue(data['amount']),
        winnerIds: Array.isArray(data['winnerIds']) ? data['winnerIds'].map(String) : [],
      };
    case 'hand.completed':
      return { type: 'hand.completed' };
    default:
      return null;
  }
}

function isTwoCards(value: unknown): value is [Card, Card] {
  return Array.isArray(value) && value.length === 2 && isCard(value[0]) && isCard(value[1]);
}

function isCard(value: unknown): value is Card {
  if (!isRecord(value)) return false;
  return isRank(value['rank']) && isSuit(value['suit']);
}

function isRank(value: unknown): value is Card['rank'] {
  return typeof value === 'string' && RANKS.has(value as Card['rank']);
}

function isSuit(value: unknown): value is Card['suit'] {
  return typeof value === 'string' && SUITS.has(value as Card['suit']);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value);
}

function numberValue(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumberValue(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function actionTypeValue(value: unknown): ActionType | null {
  return typeof value === 'string' && ACTION_TYPES.has(value as ActionType) ? (value as ActionType) : null;
}

function handPhaseValue(value: unknown): HandPhase {
  return typeof value === 'string' && HAND_PHASES.has(value as HandPhase) ? (value as HandPhase) : 'preflop';
}

function cardArrayValue(value: unknown): Card[] {
  return Array.isArray(value) ? value.filter(isCard) : [];
}

function legalActionsValue(value: unknown): LegalAction[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap(item => {
    if (!isRecord(item)) return [];

    const type = actionTypeValue(item['type']);
    if (!type) return [];

    const action: LegalAction = { type };
    const callAmount = optionalNumberValue(item['callAmount']);
    const minAmount = optionalNumberValue(item['minAmount']);
    const maxAmount = optionalNumberValue(item['maxAmount']);

    if (callAmount !== undefined) action.callAmount = callAmount;
    if (minAmount !== undefined) action.minAmount = minAmount;
    if (maxAmount !== undefined) action.maxAmount = maxAmount;

    return [action];
  });
}

function privateStateValue(value: unknown): { playerId: string; holeCards: [Card, Card] } | null {
  if (!isRecord(value)) return null;

  const holeCards = value['holeCards'];
  if (!isTwoCards(holeCards)) return null;

  return {
    playerId: stringValue(value['playerId']),
    holeCards,
  };
}

function potsValue(value: unknown): LivePotView[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap(item => {
    if (!isRecord(item)) return [];

    const amount = optionalNumberValue(item['amount']);
    return amount === undefined ? [] : [{ amount }];
  });
}
