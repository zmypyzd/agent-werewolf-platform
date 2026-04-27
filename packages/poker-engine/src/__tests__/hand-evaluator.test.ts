import { describe, it, expect } from 'vitest';
import { evaluateHand, bestHandFrom7, compareHands } from '../hand-evaluator.js';
import { cardFromString, cardsFromStrings } from '../card.js';
import type { Card } from '@agent-poker/shared';

function cards(...strs: string[]): Card[] {
  return cardsFromStrings(strs);
}

describe('evaluateHand - 5-card', () => {
  it('eval-001: royal flush (straight_flush, high A)', () => {
    const h = evaluateHand(cards('Ah','Kh','Qh','Jh','Th'));
    expect(h.category).toBe('straight_flush');
    expect(h.tiebreakers[0]).toBe(14);
  });

  it('eval-002: straight flush 9-high', () => {
    const h = evaluateHand(cards('9h','8h','7h','6h','5h'));
    expect(h.category).toBe('straight_flush');
    expect(h.tiebreakers[0]).toBe(9);
  });

  it('eval-003: wheel straight flush A-2-3-4-5', () => {
    const h = evaluateHand(cards('5h','4h','3h','2h','Ah'));
    expect(h.category).toBe('straight_flush');
    expect(h.tiebreakers[0]).toBe(5);
  });

  it('eval-004: four of a kind aces with K kicker', () => {
    const h = evaluateHand(cards('As','Ah','Ad','Ac','Kh'));
    expect(h.category).toBe('four_of_a_kind');
    expect(h.tiebreakers).toEqual([14, 13]);
  });

  it('eval-005: four of a kind 2s with A kicker', () => {
    const h = evaluateHand(cards('2s','2h','2d','2c','Ah'));
    expect(h.category).toBe('four_of_a_kind');
    expect(h.tiebreakers).toEqual([2, 14]);
  });

  it('eval-006: full house aces over kings', () => {
    const h = evaluateHand(cards('As','Ah','Ad','Ks','Kh'));
    expect(h.category).toBe('full_house');
    expect(h.tiebreakers).toEqual([14, 13]);
  });

  it('eval-007: full house 2s over kings', () => {
    const h = evaluateHand(cards('2s','2h','2d','Ks','Kh'));
    expect(h.category).toBe('full_house');
    expect(h.tiebreakers).toEqual([2, 13]);
  });

  it('eval-008: flush A-high', () => {
    const h = evaluateHand(cards('Ah','Qh','9h','7h','3h'));
    expect(h.category).toBe('flush');
    expect(h.tiebreakers).toEqual([14, 12, 9, 7, 3]);
  });

  it('eval-009: straight 9-high', () => {
    const h = evaluateHand(cards('9c','8h','7d','6s','5c'));
    expect(h.category).toBe('straight');
    expect(h.tiebreakers[0]).toBe(9);
  });

  it('eval-010: wheel straight A-2-3-4-5', () => {
    const h = evaluateHand(cards('Ah','2c','3d','4s','5h'));
    expect(h.category).toBe('straight');
    expect(h.tiebreakers[0]).toBe(5);
  });

  it('eval-011: three of a kind aces', () => {
    const h = evaluateHand(cards('Ah','As','Ad','Kh','Qc'));
    expect(h.category).toBe('three_of_a_kind');
    expect(h.tiebreakers[0]).toBe(14);
    expect(h.tiebreakers[1]).toBe(13);
    expect(h.tiebreakers[2]).toBe(12);
  });

  it('eval-012: two pair aces and kings', () => {
    const h = evaluateHand(cards('Ah','As','Kh','Ks','Qc'));
    expect(h.category).toBe('two_pair');
    expect(h.tiebreakers).toEqual([14, 13, 12]);
  });

  it('eval-013: one pair aces', () => {
    const h = evaluateHand(cards('Ah','As','Kh','Qc','Jd'));
    expect(h.category).toBe('one_pair');
    expect(h.tiebreakers).toEqual([14, 13, 12, 11]);
  });

  it('eval-014: high card A-K-Q-J-9', () => {
    const h = evaluateHand(cards('Ah','Kc','Qd','Jh','9s'));
    expect(h.category).toBe('high_card');
    expect(h.tiebreakers).toEqual([14, 13, 12, 11, 9]);
  });
});

describe('bestHandFrom7', () => {
  it('eval-015: four aces from 7 cards', () => {
    const h = bestHandFrom7(cards('Ah','Ad','As','Ac','Kh','Qd','2c'));
    expect(h.category).toBe('four_of_a_kind');
    expect(h.tiebreakers[0]).toBe(14);
  });

  it('eval-016: royal flush from 7 cards', () => {
    const h = bestHandFrom7(cards('Ah','Kh','Qh','Jh','Th','9d','8c'));
    expect(h.category).toBe('straight_flush');
    expect(h.tiebreakers[0]).toBe(14);
  });

  it('eval-017: straight flush 6-high', () => {
    const h = bestHandFrom7(cards('2h','3h','4h','5h','6h','7d','8c'));
    expect(h.category).toBe('straight_flush');
    expect(h.tiebreakers[0]).toBe(6);
  });

  it('eval-018: full house aces over kings', () => {
    const h = bestHandFrom7(cards('Ah','As','Ad','Kh','Kd','Qc','Jd'));
    expect(h.category).toBe('full_house');
    expect(h.tiebreakers).toEqual([14, 13]);
  });
});

describe('compareHands', () => {
  it('cmp-001: full_house beats flush', () => {
    const fb = evaluateHand(cards('As','Ah','Ad','Ks','Kh'));
    const fl = evaluateHand(cards('Ah','Qh','9h','7h','3h'));
    expect(compareHands(fb, fl)).toBe(-1);
  });

  it('cmp-002: higher pair wins', () => {
    const a = evaluateHand(cards('Ah','As','Kh','Qc','Jd'));
    const b = evaluateHand(cards('Kh','Ks','Ah','Qc','Jd'));
    expect(compareHands(a, b)).toBe(-1);
  });

  it('cmp-003: same pair rank, kicker decides', () => {
    const a = evaluateHand(cards('Ah','As','Kh','Qc','Jd'));
    const b = evaluateHand(cards('Ah','As','Kh','Qc','Td'));
    expect(compareHands(a, b)).toBe(-1);
  });

  it('cmp-004: same 5 cards = tie', () => {
    const a = evaluateHand(cards('Ah','Kh','Qh','Jh','Th'));
    const b = evaluateHand(cards('As','Ks','Qs','Js','Ts'));
    expect(compareHands(a, b)).toBe(0);
  });

  it('cmp-005: straight_flush beats high_card', () => {
    const sf = evaluateHand(cards('9h','8h','7h','6h','5h'));
    const hc = evaluateHand(cards('Ah','Kc','Qd','Jh','9s'));
    expect(compareHands(hc, sf)).toBe(1); // hc loses to sf
  });
});
