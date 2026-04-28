import type { WsMessage } from '../lib/ws.js';
import type { ActionType, Card, HandPhase, LegalAction, LivePotView, LiveTableEvent } from './liveTableTypes.js';

const ACTION_TYPES = new Set<ActionType>(['fold', 'check', 'call', 'bet', 'raise', 'all-in']);
const HAND_PHASES = new Set<HandPhase>(['preflop', 'flop', 'turn', 'river', 'showdown', 'complete']);
const RANKS = new Set<Card['rank']>(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);
const SUITS = new Set<Card['suit']>(['c', 'd', 'h', 's']);

export function normalizeLiveTableEvent(message: WsMessage): LiveTableEvent | null {
  const data = message.payload;
  if (!isRecord(data) || Array.isArray(data)) return null;

  switch (message.type) {
    case 'hand.started': {
      const handNumber = requiredNumberValue(data['handNumber']);
      const handId = optionalStringValue(data['handId']);
      if (handNumber === null || handId === null) return null;

      return handId === undefined
        ? { type: 'hand.started', handNumber }
        : { type: 'hand.started', handId, handNumber };
    }
    case 'seat.hole_cards': {
      const holeCards = data['holeCards'];
      if (!isTwoCards(holeCards)) return null;
      const handId = requiredStringValue(data['handId']);
      const playerId = requiredStringValue(data['playerId']);
      const seatIndex = requiredNumberValue(data['seatIndex']);
      const agentId = requiredStringValue(data['agentId']);
      if (handId === null || playerId === null || seatIndex === null || agentId === null) return null;

      return {
        type: 'seat.hole_cards',
        handId,
        playerId,
        seatIndex,
        agentId,
        holeCards,
      };
    }
    case 'community_cards.dealt': {
      const phase = handPhaseValue(data['phase']);
      const cards = cardArrayValue(data['cards']);
      if (phase === null || cards === null) return null;

      return {
        type: 'community_cards.dealt',
        phase,
        cards,
      };
    }
    case 'action.requested': {
      const playerId = requiredStringValue(data['playerId']);
      return playerId === null ? null : { type: 'action.requested', playerId };
    }
    case 'seat.action_requested': {
      const handId = requiredStringValue(data['handId']);
      const requestId = requiredStringValue(data['requestId']);
      const privateState = privateStateValue(data['privateState']);
      const legalActions = legalActionsValue(data['legalActions']);
      const deadlineAt = requiredNumberValue(data['deadlineAt']);
      if (
        handId === null ||
        requestId === null ||
        privateState === null ||
        legalActions === null ||
        deadlineAt === null
      ) {
        return null;
      }

      return {
        type: 'seat.action_requested',
        handId,
        requestId,
        legalActions,
        deadlineAt,
        privateState,
      };
    }
    case 'action.applied': {
      const playerId = requiredStringValue(data['playerId']);
      const actionType = actionTypeValue(data['actionType']);
      const amount = requiredNumberValue(data['amount']);
      const potTotal = optionalNumberValue(data['potTotal']);
      if (playerId === null || actionType === null || amount === null || potTotal === null) return null;

      const event = {
        type: 'action.applied' as const,
        playerId,
        actionType,
        amount,
      };

      return potTotal === undefined ? event : { ...event, potTotal };
    }
    case 'betting_round.complete': {
      const pots = potsValue(data['pots']);
      if (pots === null) return null;

      return {
        type: 'betting_round.complete',
        pots,
      };
    }
    case 'pot.awarded': {
      const amount = requiredNumberValue(data['amount']);
      const winnerIds = stringArrayValue(data['winnerIds']);
      if (amount === null || winnerIds === null) return null;

      return {
        type: 'pot.awarded',
        amount,
        winnerIds,
      };
    }
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

function requiredStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalStringValue(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredStringValue(value);
}

function requiredNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalNumberValue(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredNumberValue(value);
}

function actionTypeValue(value: unknown): ActionType | null {
  return typeof value === 'string' && ACTION_TYPES.has(value as ActionType) ? (value as ActionType) : null;
}

function handPhaseValue(value: unknown): HandPhase | null {
  return typeof value === 'string' && HAND_PHASES.has(value as HandPhase) ? (value as HandPhase) : null;
}

function cardArrayValue(value: unknown): Card[] | null {
  if (!Array.isArray(value)) return null;
  return value.every(isCard) ? value : null;
}

function legalActionsValue(value: unknown): LegalAction[] | null {
  if (!Array.isArray(value)) return null;

  return value.flatMap(item => {
    if (!isRecord(item)) return [null];

    const type = actionTypeValue(item['type']);
    if (!type) return [null];

    const action: LegalAction = { type };
    const callAmount = optionalNumberValue(item['callAmount']);
    const minAmount = optionalNumberValue(item['minAmount']);
    const maxAmount = optionalNumberValue(item['maxAmount']);

    if (callAmount === null || minAmount === null || maxAmount === null) return [null];

    if (callAmount !== undefined) action.callAmount = callAmount;
    if (minAmount !== undefined) action.minAmount = minAmount;
    if (maxAmount !== undefined) action.maxAmount = maxAmount;

    return [action];
  }).reduce<LegalAction[] | null>((actions, action) => {
    if (actions === null || action === null) return null;
    actions.push(action);
    return actions;
  }, []);
}

function privateStateValue(value: unknown): { playerId: string } | null {
  if (!isRecord(value)) return null;

  const playerId = requiredStringValue(value['playerId']);
  if (playerId === null) return null;

  return {
    playerId,
  };
}

function potsValue(value: unknown): LivePotView[] | null {
  if (!Array.isArray(value)) return null;

  return value.flatMap(item => {
    if (!isRecord(item)) return [null];

    const amount = optionalNumberValue(item['amount']);
    return amount === undefined || amount === null ? [null] : [{ amount }];
  }).reduce<LivePotView[] | null>((pots, pot) => {
    if (pots === null || pot === null) return null;
    pots.push(pot);
    return pots;
  }, []);
}

function stringArrayValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const strings = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return strings.length === value.length ? strings : null;
}
