import type { Pot } from '@agent-poker/shared';

export interface PlayerContribution {
  playerId: string;
  totalBetInHand: number;
  status: string; // 'folded' | 'active' | 'all-in'
}

export function computePots(players: PlayerContribution[]): Pot[] {
  if (players.length === 0) return [];

  // Gather all unique all-in levels (from all-in players), sorted ascending
  const allInLevels = [...new Set(
    players
      .filter(p => p.status === 'all-in')
      .map(p => p.totalBetInHand)
  )].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let processedLevel = 0;

  for (const level of allInLevels) {
    const cap = level;
    let potAmount = 0;
    const eligible: string[] = [];

    for (const p of players) {
      const contribution = Math.min(p.totalBetInHand, cap) - Math.min(p.totalBetInHand, processedLevel);
      const actualContrib = Math.max(0, contribution);
      potAmount += actualContrib;
      if (p.status !== 'folded' && p.totalBetInHand >= cap) {
        eligible.push(p.playerId);
      }
    }

    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligiblePlayerIds: eligible });
    }
    processedLevel = cap;
  }

  // Main pot: remaining chips after all all-in levels
  let mainPotAmount = 0;
  const mainEligible: string[] = [];

  for (const p of players) {
    const contribution = Math.max(0, p.totalBetInHand - processedLevel);
    mainPotAmount += contribution;
    if (p.status !== 'folded') {
      mainEligible.push(p.playerId);
    }
  }

  if (mainPotAmount > 0) {
    pots.push({ amount: mainPotAmount, eligiblePlayerIds: mainEligible });
  }

  // Merge pots where only one player is eligible (give it back to them directly)
  // Actually don't merge — keep structure. But collapse single-eligible pots at end.

  return pots.filter(p => p.amount > 0);
}
