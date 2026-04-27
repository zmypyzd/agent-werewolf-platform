import type { Rank, Suit, HandRankCategory } from './types.js';

export const RANKS: Rank[] = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
export const SUITS: Suit[] = ['c','d','h','s'];
export const RANK_VALUES: Record<Rank, number> = {
  '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
  'T':10,'J':11,'Q':12,'K':13,'A':14
};
export const HAND_CATEGORY_RANK: Record<HandRankCategory, number> = {
  'high_card':0,'one_pair':1,'two_pair':2,'three_of_a_kind':3,
  'straight':4,'flush':5,'full_house':6,'four_of_a_kind':7,'straight_flush':8
};
export const DEFAULT_TIMEOUT_MS = 5000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 9;
export const DECK_SIZE = 52;
export const HOLE_CARDS_PER_PLAYER = 2;
export const COMMUNITY_CARDS_TOTAL = 5;
