import type { PlayerInHand, LegalAction } from '@agent-poker/shared';

interface RoundContext {
  currentRoundMinBet: number;
  minRaiseAmount: number;
}

export function computeLegalActions(
  player: PlayerInHand,
  roundState: RoundContext,
  bigBlind: number,
): LegalAction[] {
  if (player.status === 'folded' || player.status === 'all-in' || player.status === 'sitting-out') {
    return [];
  }

  const { currentRoundMinBet, minRaiseAmount } = roundState;
  const stack = player.stack;
  const alreadyBet = player.currentRoundBet;
  const callAmount = currentRoundMinBet - alreadyBet; // how much more needed to call

  const actions: LegalAction[] = [];

  if (callAmount <= 0) {
    // No bet to call — can check
    actions.push({ type: 'check' });

    // Can bet
    const minBet = bigBlind;
    if (stack > 0) {
      if (stack <= minBet) {
        // Only all-in available as bet
        actions.push({ type: 'all-in', maxAmount: stack });
      } else {
        actions.push({ type: 'bet', minAmount: minBet, maxAmount: stack });
        actions.push({ type: 'all-in', maxAmount: stack });
      }
    }
  } else {
    // Facing a bet
    actions.push({ type: 'fold' });

    if (stack <= callAmount) {
      // Can only go all-in (partial call)
      actions.push({ type: 'all-in', maxAmount: stack });
    } else {
      // Can call
      actions.push({ type: 'call', callAmount });

      // Can raise
      const minRaiseTo = currentRoundMinBet + Math.max(minRaiseAmount, bigBlind);
      const maxRaiseTo = alreadyBet + stack;

      if (maxRaiseTo > currentRoundMinBet + Math.max(minRaiseAmount, bigBlind) || maxRaiseTo === alreadyBet + stack) {
        if (stack > callAmount) {
          const effectiveMin = Math.min(minRaiseTo, alreadyBet + stack);
          const effectiveMax = alreadyBet + stack;
          if (effectiveMin <= effectiveMax && effectiveMin > currentRoundMinBet) {
            actions.push({ type: 'raise', minAmount: effectiveMin, maxAmount: effectiveMax });
          }
          actions.push({ type: 'all-in', maxAmount: stack });
        }
      }
    }
  }

  return actions;
}
