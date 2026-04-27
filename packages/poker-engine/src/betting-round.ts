import { randomUUID } from 'crypto';
import type { BettingRoundState, PlayerInHand, ActionType, GameAction } from '@agent-poker/shared';

export function applyAction(
  state: BettingRoundState,
  action: { playerId: string; actionType: ActionType; amount: number },
): BettingRoundState {
  const players = state.players.map(p => ({ ...p }));
  const actorIdx = state.currentActorIndex;
  const actor = players[actorIdx];
  if (!actor) throw new Error('No actor at currentActorIndex');

  let currentRoundMinBet = state.currentRoundMinBet;
  let minRaiseAmount = state.minRaiseAmount;
  let lastAggressorIndex = state.lastAggressorIndex;

  const gameAction: GameAction = {
    actionId: randomUUID(),
    handId: state.handId,
    playerId: actor.playerId,
    phase: state.phase,
    actionType: action.actionType,
    amount: action.amount,
    stackAfter: actor.stack,
    sequence: state.roundActions.length,
    timestamp: Date.now(),
  };

  switch (action.actionType) {
    case 'fold':
      actor.status = 'folded';
      break;

    case 'check':
      // No change to stack
      break;

    case 'call': {
      const callAmount = Math.min(action.amount, actor.stack);
      actor.stack -= callAmount;
      actor.currentRoundBet += callAmount;
      actor.totalBetInHand += callAmount;
      if (actor.stack === 0) actor.status = 'all-in';
      gameAction.amount = callAmount;
      break;
    }

    case 'bet': {
      const betAmount = Math.min(action.amount - actor.currentRoundBet, actor.stack);
      const totalBet = actor.currentRoundBet + betAmount;
      actor.stack -= betAmount;
      actor.totalBetInHand += betAmount;
      const prevMin = currentRoundMinBet;
      currentRoundMinBet = totalBet;
      minRaiseAmount = totalBet - prevMin;
      actor.currentRoundBet = totalBet;
      lastAggressorIndex = actorIdx;
      if (actor.stack === 0) actor.status = 'all-in';
      gameAction.amount = totalBet;
      break;
    }

    case 'raise': {
      const raiseToTotal = action.amount; // total bet amount
      const additional = raiseToTotal - actor.currentRoundBet;
      const actualAdditional = Math.min(additional, actor.stack);
      const actualTotal = actor.currentRoundBet + actualAdditional;
      const raiseIncrement = actualTotal - currentRoundMinBet;
      actor.stack -= actualAdditional;
      actor.totalBetInHand += actualAdditional;
      actor.currentRoundBet = actualTotal;
      if (raiseIncrement > 0) minRaiseAmount = raiseIncrement;
      currentRoundMinBet = actualTotal;
      lastAggressorIndex = actorIdx;
      if (actor.stack === 0) actor.status = 'all-in';
      gameAction.amount = actualTotal;
      break;
    }

    case 'all-in': {
      const allInAmount = actor.stack;
      const totalAllIn = actor.currentRoundBet + allInAmount;
      actor.totalBetInHand += allInAmount;
      actor.currentRoundBet = totalAllIn;
      actor.stack = 0;
      actor.status = 'all-in';
      if (totalAllIn > currentRoundMinBet) {
        const raiseIncrement = totalAllIn - currentRoundMinBet;
        if (raiseIncrement >= minRaiseAmount) {
          lastAggressorIndex = actorIdx;
          minRaiseAmount = raiseIncrement;
        }
        currentRoundMinBet = totalAllIn;
      }
      gameAction.amount = allInAmount;
      break;
    }
  }

  gameAction.stackAfter = actor.stack;

  const nextActorIdx = getNextActiveActorIndex({ ...state, players, currentActorIndex: actorIdx });

  return {
    ...state,
    players,
    currentActorIndex: nextActorIdx ?? actorIdx,
    currentRoundMinBet,
    minRaiseAmount,
    lastAggressorIndex,
    roundActions: [...state.roundActions, gameAction],
  };
}

export function getNextActiveActorIndex(state: BettingRoundState): number | null {
  const { players, currentActorIndex } = state;
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (currentActorIndex + i) % n;
    const p = players[idx];
    if (p && p.status === 'active') return idx;
  }
  return null;
}

export function isBettingRoundComplete(state: BettingRoundState): boolean {
  const activePlayers = state.players.filter(p => p.status === 'active');

  if (activePlayers.length <= 1) return true;

  // Everyone who is active must have matched the current bet
  const allMatched = activePlayers.every(p => p.currentRoundBet === state.currentRoundMinBet);

  if (!allMatched) return false;

  // If no one has acted yet (lastAggressor is null and no round actions), not complete
  // unless there's no bet and everyone checked (roundActions length >= activePlayers)
  if (state.lastAggressorIndex === null) {
    // No aggressor: complete when everyone has had a chance to act (checked or called)
    // Each active player must have acted at least once
    const activeIds = new Set(activePlayers.map(p => p.playerId));
    const actedIds = new Set(state.roundActions.map(a => a.playerId));
    return [...activeIds].every(id => actedIds.has(id));
  }

  // There was an aggressor: round is complete when we've gone around back to the aggressor
  // and everyone has matched
  // The current actor should be the aggressor (meaning everyone else has acted after the raise)
  return state.currentActorIndex === state.lastAggressorIndex && allMatched;
}
