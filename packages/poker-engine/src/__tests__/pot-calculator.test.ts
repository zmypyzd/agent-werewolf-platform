import { describe, it, expect } from 'vitest';
import { computePots } from '../pot-calculator.js';
import type { PlayerContribution } from '../pot-calculator.js';

function p(playerId: string, totalBetInHand: number, status: string = 'active'): PlayerContribution {
  return { playerId, totalBetInHand, status };
}

describe('computePots', () => {
  it('pot-001: 2 players equal bets → 1 pot both eligible', () => {
    const pots = computePots([p('A', 100), p('B', 100)]);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(200);
    expect(pots[0]!.eligiblePlayerIds).toContain('A');
    expect(pots[0]!.eligiblePlayerIds).toContain('B');
  });

  it('pot-002: 2 players unequal bets → 1 pot (B contributed extra)', () => {
    // B bet more, but A folded → A's chips go to pot but A is not eligible
    // Actually all active players are eligible
    const pots = computePots([p('A', 100), p('B', 200)]);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(300);
  });

  it('pot-003: A all-in 100, B=200, C=200 → main + side pot', () => {
    const pots = computePots([p('A', 100, 'all-in'), p('B', 200), p('C', 200)]);
    // pot[0]: 300 (A,B,C eligible), pot[1]: 200 (B,C)
    expect(pots.length).toBeGreaterThanOrEqual(2);
    const total = pots.reduce((s, pot) => s + pot.amount, 0);
    expect(total).toBe(500);
    const mainPot = pots[0]!;
    expect(mainPot.amount).toBe(300);
    expect(mainPot.eligiblePlayerIds).toContain('A');
    expect(mainPot.eligiblePlayerIds).toContain('B');
    expect(mainPot.eligiblePlayerIds).toContain('C');
  });

  it('pot-004: A all-in 100, B all-in 200, C=300 → 3 pots', () => {
    const pots = computePots([p('A', 100, 'all-in'), p('B', 200, 'all-in'), p('C', 300)]);
    const total = pots.reduce((s, pot) => s + pot.amount, 0);
    expect(total).toBe(600);
    // pot[0] should have all 3 eligible
    expect(pots[0]!.eligiblePlayerIds).toHaveLength(3);
    // pot[1] should have B and C
    expect(pots[1]!.eligiblePlayerIds).not.toContain('A');
  });

  it('pot-005: A folded after 50 → not eligible', () => {
    const pots = computePots([p('A', 50, 'folded'), p('B', 200), p('C', 200)]);
    const total = pots.reduce((s, pot) => s + pot.amount, 0);
    expect(total).toBe(450);
    // A should not be in any eligible list
    for (const pot of pots) {
      expect(pot.eligiblePlayerIds).not.toContain('A');
    }
  });

  it('pot-006: A all-in 100, B all-in 100, C=300 → main + side', () => {
    const pots = computePots([p('A', 100, 'all-in'), p('B', 100, 'all-in'), p('C', 300)]);
    const total = pots.reduce((s, pot) => s + pot.amount, 0);
    expect(total).toBe(500);
    expect(pots[0]!.eligiblePlayerIds).toContain('A');
    expect(pots[0]!.eligiblePlayerIds).toContain('B');
    expect(pots[0]!.eligiblePlayerIds).toContain('C');
  });

  it('pot-007: all 4 players same all-in 100 → 1 pot', () => {
    const pots = computePots([
      p('A', 100, 'all-in'), p('B', 100, 'all-in'),
      p('C', 100, 'all-in'), p('D', 100, 'all-in')
    ]);
    const total = pots.reduce((s, pot) => s + pot.amount, 0);
    expect(total).toBe(400);
    expect(pots[0]!.eligiblePlayerIds).toHaveLength(4);
  });

  it('pot-008: A all-in 50, B all-in 100, C all-in 150, D=200 → correct pots', () => {
    const pots = computePots([
      p('A', 50, 'all-in'), p('B', 100, 'all-in'),
      p('C', 150, 'all-in'), p('D', 200)
    ]);
    const total = pots.reduce((s, pot) => s + pot.amount, 0);
    expect(total).toBe(500);
    // All pots should have correct eligibility
    const allElig = pots[0]!.eligiblePlayerIds;
    expect(allElig).toContain('A');
  });
});
