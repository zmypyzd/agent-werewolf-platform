import type { Pot, HandEvaluation } from '@agent-poker/shared';
import { compareHands } from './hand-evaluator.js';

export interface PotAward {
  potIndex: number;
  amount: number;
  winnerIds: string[];
  splitAmount: number;
  remainderChipTo?: string;
  reason: 'best_hand' | 'tie' | 'uncontested';
}

export function determineWinners(
  pots: Pot[],
  playerHands: Map<string, HandEvaluation>,
  buttonSeatOrder: string[], // player IDs in order starting left of button (for tie-break)
): PotAward[] {
  const awards: PotAward[] = [];

  for (let i = 0; i < pots.length; i++) {
    const pot = pots[i]!;
    const eligible = pot.eligiblePlayerIds.filter(id => playerHands.has(id));

    if (eligible.length === 0) {
      // No eligible player with a hand — shouldn't happen, but skip
      continue;
    }

    if (eligible.length === 1) {
      awards.push({
        potIndex: i,
        amount: pot.amount,
        winnerIds: [eligible[0]!],
        splitAmount: pot.amount,
        reason: 'uncontested',
      });
      continue;
    }

    // Find best hand among eligible
    let bestEval: HandEvaluation | null = null;
    for (const pid of eligible) {
      const hand = playerHands.get(pid)!;
      if (!bestEval || compareHands(hand, bestEval) === -1) {
        bestEval = hand;
      }
    }

    // Find all winners (those who tie with best hand)
    const winners = eligible.filter(pid => {
      const hand = playerHands.get(pid)!;
      return compareHands(hand, bestEval!) === 0;
    });

    if (winners.length === 1) {
      awards.push({
        potIndex: i,
        amount: pot.amount,
        winnerIds: winners,
        splitAmount: pot.amount,
        reason: 'best_hand',
      });
    } else {
      // Split pot
      const splitAmount = Math.floor(pot.amount / winners.length);
      const remainder = pot.amount - splitAmount * winners.length;

      // Remainder chip to first winner in button order
      let remainderChipTo: string | undefined;
      if (remainder > 0) {
        for (const pid of buttonSeatOrder) {
          if (winners.includes(pid)) {
            remainderChipTo = pid;
            break;
          }
        }
      }

      const award: PotAward = {
        potIndex: i,
        amount: pot.amount,
        winnerIds: winners,
        splitAmount,
        reason: 'tie',
      };
      if (remainderChipTo !== undefined) award.remainderChipTo = remainderChipTo;
      awards.push(award);
    }
  }

  return awards;
}
