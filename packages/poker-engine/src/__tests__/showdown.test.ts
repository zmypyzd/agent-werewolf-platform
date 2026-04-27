import { describe, it, expect } from 'vitest';
import { determineWinners } from '../showdown.js';
import { evaluateHand } from '../hand-evaluator.js';
import { cardsFromStrings } from '../card.js';
import type { Pot, HandEvaluation } from '@agent-poker/shared';

function eval5(strs: string[]): HandEvaluation {
  return evaluateHand(cardsFromStrings(strs));
}

describe('determineWinners', () => {
  it('show-001: single winner takes full pot', () => {
    const pots: Pot[] = [{ amount: 200, eligiblePlayerIds: ['A', 'B'] }];
    const hands = new Map([
      ['A', eval5(['As','Ah','Ad','Ac','Kh'])], // quad aces
      ['B', eval5(['Ks','Kh','Kd','Kc','Qh'])], // quad kings
    ]);
    const awards = determineWinners(pots, hands, ['A','B']);
    expect(awards[0]!.winnerIds).toEqual(['A']);
    expect(awards[0]!.amount).toBe(200);
  });

  it('show-002: two-way tie splits 50/50', () => {
    const pots: Pot[] = [{ amount: 200, eligiblePlayerIds: ['A', 'B'] }];
    const hands = new Map([
      ['A', eval5(['Ah','Kh','Qh','Jh','Th'])], // royal flush
      ['B', eval5(['As','Ks','Qs','Js','Ts'])], // royal flush
    ]);
    const awards = determineWinners(pots, hands, ['A','B']);
    expect(awards[0]!.winnerIds).toHaveLength(2);
    expect(awards[0]!.splitAmount).toBe(100);
  });

  it('show-003: odd chip split — remainder to first in buttonSeatOrder', () => {
    const pots: Pot[] = [{ amount: 201, eligiblePlayerIds: ['A', 'B'] }];
    const hands = new Map([
      ['A', eval5(['Ah','Kh','Qh','Jh','Th'])],
      ['B', eval5(['As','Ks','Qs','Js','Ts'])],
    ]);
    const awards = determineWinners(pots, hands, ['A','B']);
    expect(awards[0]!.splitAmount).toBe(100);
    expect(awards[0]!.remainderChipTo).toBe('A');
  });

  it('show-004: main pot + side pot, different winners', () => {
    const pots: Pot[] = [
      { amount: 300, eligiblePlayerIds: ['A','B','C'] },
      { amount: 200, eligiblePlayerIds: ['B','C'] },
    ];
    const hands = new Map([
      ['A', eval5(['As','Ah','Ad','Ac','Kh'])], // quad aces — wins main
      ['B', eval5(['Ks','Kh','Kd','Kc','Qh'])], // quad kings
      ['C', eval5(['Qs','Qh','Qd','Qc','Jh'])], // quad queens
    ]);
    const awards = determineWinners(pots, hands, ['A','B','C']);
    const mainAward = awards.find(a => a.potIndex === 0)!;
    const sideAward = awards.find(a => a.potIndex === 1)!;
    expect(mainAward.winnerIds).toContain('A');
    expect(sideAward.winnerIds).toContain('B');
    expect(sideAward.winnerIds).not.toContain('A');
  });

  it('show-005: folded player not in eligible list → wins nothing', () => {
    // Folded player is simply not in eligible list
    const pots: Pot[] = [{ amount: 200, eligiblePlayerIds: ['B'] }];
    const hands = new Map([
      ['B', eval5(['2s','3h','4d','5c','7h'])], // high card
    ]);
    const awards = determineWinners(pots, hands, ['A','B']);
    expect(awards[0]!.winnerIds).toContain('B');
    expect(awards[0]!.winnerIds).not.toContain('A');
  });

  it('show-006: 3-way tie splits evenly', () => {
    const pots: Pot[] = [{ amount: 300, eligiblePlayerIds: ['A','B','C'] }];
    const rf = eval5(['Ah','Kh','Qh','Jh','Th']);
    const hands = new Map([['A', rf], ['B', rf], ['C', rf]]);
    const awards = determineWinners(pots, hands, ['A','B','C']);
    expect(awards[0]!.splitAmount).toBe(100);
    expect(awards[0]!.winnerIds).toHaveLength(3);
  });

  it('show-007: 3-way tie 301 chips — first in buttonSeatOrder gets remainder', () => {
    const pots: Pot[] = [{ amount: 301, eligiblePlayerIds: ['p1','p2','p3'] }];
    const rf = eval5(['Ah','Kh','Qh','Jh','Th']);
    const hands = new Map([['p1', rf], ['p2', rf], ['p3', rf]]);
    const awards = determineWinners(pots, hands, ['p1','p2','p3']);
    expect(awards[0]!.splitAmount).toBe(100);
    expect(awards[0]!.remainderChipTo).toBe('p1');
  });

  it('show-008: all-in player only wins main pot they are eligible for', () => {
    const pots: Pot[] = [
      { amount: 300, eligiblePlayerIds: ['A','B','C'] },
      { amount: 400, eligiblePlayerIds: ['B','C'] },
    ];
    const hands = new Map([
      ['A', eval5(['As','Ah','Ad','Ac','Kh'])], // best hand (wins main)
      ['B', eval5(['2s','3h','4d','5c','7h'])], // high card (loses)
      ['C', eval5(['Ks','Kh','Kd','Kc','Qh'])], // quad kings (wins side)
    ]);
    const awards = determineWinners(pots, hands, ['A','B','C']);
    const mainAward = awards.find(a => a.potIndex === 0)!;
    expect(mainAward.winnerIds).toContain('A');
    const sideAward = awards.find(a => a.potIndex === 1)!;
    expect(sideAward.winnerIds).toContain('C');
    expect(sideAward.winnerIds).not.toContain('A');
  });
});
