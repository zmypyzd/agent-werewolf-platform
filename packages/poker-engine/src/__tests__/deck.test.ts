import { describe, it, expect } from 'vitest';
import { createShuffledDeck, deal } from '../deck.js';

describe('createShuffledDeck', () => {
  it('deck-001: returns 52 cards', () => {
    const deck = createShuffledDeck('seed-A');
    expect(deck.cards.length).toBe(52);
  });

  it('deck-002: all 52 cards are unique', () => {
    const deck = createShuffledDeck('seed-A');
    const seen = new Set(deck.cards.map(c => `${c.rank}${c.suit}`));
    expect(seen.size).toBe(52);
  });

  it('deck-003: same seed → identical card order', () => {
    const d1 = createShuffledDeck('seed-A');
    const d2 = createShuffledDeck('seed-A');
    expect(d1.cards).toEqual(d2.cards);
  });

  it('deck-004: different seeds → different order', () => {
    const d1 = createShuffledDeck('seed-A');
    const d2 = createShuffledDeck('seed-B');
    const same = d1.cards.every((c, i) => c.rank === d2.cards[i]?.rank && c.suit === d2.cards[i]?.suit);
    expect(same).toBe(false);
  });

  it('deck-009: dealtCount starts at 0', () => {
    const deck = createShuffledDeck('seed-A');
    expect(deck.dealtCount).toBe(0);
  });
});

describe('deal', () => {
  it('deck-005: returns exactly n cards', () => {
    const deck = createShuffledDeck('seed-A');
    const [cards] = deal(deck, 5);
    expect(cards.length).toBe(5);
  });

  it('deck-006: deal is sequential', () => {
    const deck = createShuffledDeck('seed-A');
    const [first, d1] = deal(deck, 2);
    const [second] = deal(d1, 2);
    expect(first[0]).toEqual(deck.cards[0]);
    expect(second[0]).toEqual(deck.cards[2]);
  });

  it('deck-007: does not mutate original deck', () => {
    const deck = createShuffledDeck('seed-A');
    const originalCount = deck.dealtCount;
    deal(deck, 5);
    expect(deck.dealtCount).toBe(originalCount);
  });

  it('deck-008: throws when requesting more cards than remain', () => {
    const deck = createShuffledDeck('seed-A');
    const [, d1] = deal(deck, 50);
    expect(() => deal(d1, 5)).toThrow();
  });

  it('deck-009: dealtCount advances correctly', () => {
    const deck = createShuffledDeck('seed-A');
    const [, d1] = deal(deck, 3);
    expect(d1.dealtCount).toBe(3);
    const [, d2] = deal(d1, 5);
    expect(d2.dealtCount).toBe(8);
  });

  it('deck-010: dealing all 52 cards produces all unique cards', () => {
    const deck = createShuffledDeck('seed-A');
    const [cards] = deal(deck, 52);
    const seen = new Set(cards.map(c => `${c.rank}${c.suit}`));
    expect(seen.size).toBe(52);
  });
});
