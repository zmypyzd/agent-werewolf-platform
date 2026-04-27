import { RANKS, SUITS } from '@agent-poker/shared';
import type { Card, Deck } from '@agent-poker/shared';
import { createSeededRng } from './prng.js';

function buildFullDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ rank, suit });
    }
  }
  return cards;
}

function fisherYatesShuffle(cards: Card[], rng: () => number): Card[] {
  const arr = [...cards];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

export function createShuffledDeck(seed: string): Deck {
  const rng = createSeededRng(seed);
  const cards = fisherYatesShuffle(buildFullDeck(), rng);
  return { cards, seed, dealtCount: 0 };
}

export function deal(deck: Deck, n: number): [Card[], Deck] {
  const remaining = deck.cards.length - deck.dealtCount;
  if (n > remaining) {
    throw new Error(`Cannot deal ${n} cards; only ${remaining} remain`);
  }
  const dealt = deck.cards.slice(deck.dealtCount, deck.dealtCount + n);
  const newDeck: Deck = { ...deck, dealtCount: deck.dealtCount + n };
  return [dealt, newDeck];
}
