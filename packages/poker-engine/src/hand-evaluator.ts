import { RANK_VALUES, HAND_CATEGORY_RANK } from '@agent-poker/shared';
import type { Card, HandEvaluation, HandRankCategory } from '@agent-poker/shared';

function rankVal(r: string): number {
  return RANK_VALUES[r as keyof typeof RANK_VALUES] ?? 0;
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  if (first === undefined) return [];
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length !== 5) throw new Error(`evaluateHand requires exactly 5 cards, got ${cards.length}`);

  const rankCounts = new Map<string, number>();
  const suitCounts = new Map<string, number>();
  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }

  const isFlush = [...suitCounts.values()].some(v => v === 5);

  const sortedVals = [...new Set(cards.map(c => rankVal(c.rank)))].sort((a, b) => a - b);
  let isStraight = false;
  let straightHighCard = 0;

  if (sortedVals.length >= 5) {
    const top = sortedVals[sortedVals.length - 1]!;
    const bottom = sortedVals[0]!;
    if (top - bottom === 4) {
      isStraight = true;
      straightHighCard = top;
    }
  }
  // Wheel: A-2-3-4-5
  if (!isStraight && sortedVals.includes(14) && sortedVals.includes(2) && sortedVals.includes(3) && sortedVals.includes(4) && sortedVals.includes(5)) {
    isStraight = true;
    straightHighCard = 5;
  }

  const counts = [...rankCounts.values()].sort((a, b) => b - a);
  const is4OfAKind = counts[0] === 4;
  const isFullHouse = counts[0] === 3 && counts[1] === 2;
  const is3OfAKind = counts[0] === 3 && counts[1] !== 2;
  const is2Pair = counts[0] === 2 && counts[1] === 2;
  const is1Pair = counts[0] === 2 && counts[1] !== 2;

  let category: HandRankCategory;
  let tiebreakers: number[];
  let bestCards: [Card, Card, Card, Card, Card];

  const sortedCards = [...cards].sort((a, b) => rankVal(b.rank) - rankVal(a.rank));

  if (isFlush && isStraight) {
    category = 'straight_flush';
    tiebreakers = [straightHighCard];
    if (straightHighCard === 5) {
      // Wheel: A is low, so order is 5,4,3,2,A
      const wheel = [5,4,3,2,14];
      bestCards = wheel.map(v => cards.find(c => (v === 14 ? rankVal(c.rank) === 14 : rankVal(c.rank) === v))!) as [Card,Card,Card,Card,Card];
    } else {
      bestCards = [...sortedCards] as [Card,Card,Card,Card,Card];
    }
  } else if (is4OfAKind) {
    category = 'four_of_a_kind';
    const quadRank = [...rankCounts.entries()].find(([,v]) => v === 4)![0]!;
    const kickerRank = [...rankCounts.entries()].find(([,v]) => v === 1)![0]!;
    tiebreakers = [rankVal(quadRank), rankVal(kickerRank)];
    bestCards = sortedCards as [Card,Card,Card,Card,Card];
  } else if (isFullHouse) {
    category = 'full_house';
    const tripRank = [...rankCounts.entries()].find(([,v]) => v === 3)![0]!;
    const pairRank = [...rankCounts.entries()].find(([,v]) => v === 2)![0]!;
    tiebreakers = [rankVal(tripRank), rankVal(pairRank)];
    bestCards = sortedCards as [Card,Card,Card,Card,Card];
  } else if (isFlush) {
    category = 'flush';
    tiebreakers = sortedCards.map(c => rankVal(c.rank));
    bestCards = sortedCards as [Card,Card,Card,Card,Card];
  } else if (isStraight) {
    category = 'straight';
    tiebreakers = [straightHighCard];
    if (straightHighCard === 5) {
      const wheel = [5,4,3,2,14];
      bestCards = wheel.map(v => cards.find(c => rankVal(c.rank) === v)!) as [Card,Card,Card,Card,Card];
    } else {
      bestCards = sortedCards as [Card,Card,Card,Card,Card];
    }
  } else if (is3OfAKind) {
    category = 'three_of_a_kind';
    const tripRank = [...rankCounts.entries()].find(([,v]) => v === 3)![0]!;
    const kickers = sortedCards.filter(c => rankVal(c.rank) !== rankVal(tripRank)).map(c => rankVal(c.rank));
    tiebreakers = [rankVal(tripRank), ...kickers];
    bestCards = sortedCards as [Card,Card,Card,Card,Card];
  } else if (is2Pair) {
    category = 'two_pair';
    const pairs = [...rankCounts.entries()].filter(([,v]) => v === 2).map(([r]) => rankVal(r)).sort((a,b) => b - a);
    const kicker = sortedCards.find(c => !pairs.includes(rankVal(c.rank)));
    tiebreakers = [...pairs, kicker ? rankVal(kicker.rank) : 0];
    bestCards = sortedCards as [Card,Card,Card,Card,Card];
  } else if (is1Pair) {
    category = 'one_pair';
    const pairRank = [...rankCounts.entries()].find(([,v]) => v === 2)![0]!;
    const kickers = sortedCards.filter(c => rankVal(c.rank) !== rankVal(pairRank)).map(c => rankVal(c.rank));
    tiebreakers = [rankVal(pairRank), ...kickers];
    bestCards = sortedCards as [Card,Card,Card,Card,Card];
  } else {
    category = 'high_card';
    tiebreakers = sortedCards.map(c => rankVal(c.rank));
    bestCards = sortedCards as [Card,Card,Card,Card,Card];
  }

  return {
    category,
    categoryRank: HAND_CATEGORY_RANK[category],
    tiebreakers,
    bestCards,
    description: buildDescription(category, tiebreakers),
  };
}

function buildDescription(cat: HandRankCategory, tb: number[]): string {
  const rankName = (v: number): string => {
    const names: Record<number,string> = {2:'2s',3:'3s',4:'4s',5:'5s',6:'6s',7:'7s',8:'8s',9:'9s',10:'Tens',11:'Jacks',12:'Queens',13:'Kings',14:'Aces'};
    return names[v] ?? String(v);
  };
  switch (cat) {
    case 'straight_flush': return tb[0] === 14 ? 'Royal Flush' : `Straight Flush, ${tb[0]}-high`;
    case 'four_of_a_kind': return `Four of a Kind, ${rankName(tb[0]!)}`;
    case 'full_house': return `Full House, ${rankName(tb[0]!)} over ${rankName(tb[1]!)}`;
    case 'flush': return `Flush, ${tb[0]}-high`;
    case 'straight': return `Straight, ${tb[0]}-high`;
    case 'three_of_a_kind': return `Three of a Kind, ${rankName(tb[0]!)}`;
    case 'two_pair': return `Two Pair, ${rankName(tb[0]!)} and ${rankName(tb[1]!)}`;
    case 'one_pair': return `One Pair, ${rankName(tb[0]!)}`;
    case 'high_card': return `High Card, ${tb[0]}`;
  }
}

export function compareHands(a: HandEvaluation, b: HandEvaluation): -1 | 0 | 1 {
  if (a.categoryRank !== b.categoryRank) {
    return a.categoryRank > b.categoryRank ? -1 : 1;
  }
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const av = a.tiebreakers[i] ?? 0;
    const bv = b.tiebreakers[i] ?? 0;
    if (av !== bv) return av > bv ? -1 : 1;
  }
  return 0;
}

export function bestHandFrom7(cards: Card[]): HandEvaluation {
  if (cards.length < 5) throw new Error('Need at least 5 cards');
  const combos = combinations(cards, 5);
  let best: HandEvaluation | null = null;
  for (const combo of combos) {
    const eval5 = evaluateHand(combo);
    if (!best || compareHands(eval5, best) === -1) {
      best = eval5;
    }
  }
  return best!;
}
