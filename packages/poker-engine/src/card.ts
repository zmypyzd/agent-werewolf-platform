import type { Card, Rank, Suit } from '@agent-poker/shared';

export function cardToString(c: Card): string {
  return `${c.rank}${c.suit}`;
}

export function cardFromString(s: string): Card {
  if (s.length < 2 || s.length > 2) {
    throw new Error(`Invalid card string: "${s}" — expected 2 chars like "As" or "Tc"`);
  }
  const rank = s[0] as Rank;
  const suit = s[1] as Suit;
  return { rank, suit };
}

export function cardsFromStrings(strs: string[]): Card[] {
  return strs.map(cardFromString);
}
