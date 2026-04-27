export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Suit = 'c' | 'd' | 'h' | 's';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';
export type HandPhase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export interface ReplayEvent {
  eventId: string;
  handId: string;
  tableId: string;
  sequence: number;
  eventType: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface PublicHandAction {
  actionId: string;
  handId: string;
  playerId: string;
  phase: HandPhase;
  actionType: ActionType;
  amount: number;
  stackAfter: number;
  sequence: number;
  timestamp: number;
}

export interface BlindConfig {
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface PublicHandPlayerSummary {
  playerId: string;
  agentId: string;
  seatIndex: number;
  stackBefore: number;
  stackAfter: number;
}

export interface HandResult {
  playerId: string;
  seatIndex: number;
  potIndex: number;
  winAmount: number;
  netChange: number;
}

export interface HandSummary {
  handId: string;
  tableId: string;
  handNumber: number;
  seed: string;
  startedAt: number;
  completedAt: number;
  players: PublicHandPlayerSummary[];
  blindConfig: BlindConfig;
  communityCards: Card[];
  allActions: PublicHandAction[];
  results: HandResult[];
  finalPots: Pot[];
}

export interface MatchArtifactFileRef {
  path: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface MatchArtifactManifest {
  artifactVersion: 1;
  matchId: string;
  tableId: string;
  createdAt: number;
  handIds: string[];
  files: {
    summary: MatchArtifactFileRef;
    replay: MatchArtifactFileRef;
    decisionTrace: MatchArtifactFileRef;
    analysisSummary: MatchArtifactFileRef;
  };
}

export interface MatchSummary {
  matchId: string;
  tableId: string;
  name: string;
  seed: string;
  startedAt: number;
  completedAt: number;
  handIds: string[];
  hands: HandSummary[];
  finalStacks: Record<string, number>;
  agentIds: string[];
}

export interface MatchArtifactRecord {
  manifest: MatchArtifactManifest;
  summary: MatchSummary;
}
