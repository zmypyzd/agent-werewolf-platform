export type Rank = '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'|'A';
export type Suit = 'c'|'d'|'h'|'s';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export interface Deck {
  cards: Card[];
  seed: string;
  dealtCount: number;
}

export type ActionType = 'fold'|'check'|'call'|'bet'|'raise'|'all-in';
export type HandPhase = 'preflop'|'flop'|'turn'|'river'|'showdown'|'complete';
export type DecisionTracePhase = 'preflop'|'flop'|'turn'|'river';
export type PlayerStatus = 'waiting'|'active'|'folded'|'all-in'|'sitting-out';
export type TableStatus = 'preparing'|'in_hand'|'paused'|'completed';
export type SeatAdapterType = 'human'|'http'|'mock';
export type AgentAdapterType = 'mock'|'http'|'websocket'|'openclaw';
export type ReasoningIntent =
  | 'value'
  | 'bluff'
  | 'semi_bluff'
  | 'pot_control'
  | 'protection'
  | 'information'
  | 'survival'
  | 'unknown';
export type ReasoningRiskLevel = 'low'|'medium'|'high';
export type DecisionTraceFallbackReason = 'timeout'|'invalid_action'|'missing_agent';
export type HandRankCategory =
  | 'high_card'|'one_pair'|'two_pair'|'three_of_a_kind'
  | 'straight'|'flush'|'full_house'|'four_of_a_kind'|'straight_flush';

export interface LegalAction {
  type: ActionType;
  callAmount?: number;
  minAmount?: number;
  maxAmount?: number;
}

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface SidePot {
  amount: number;
  eligiblePlayerIds: string[];
  capPerPlayer: number;
}

export interface PlayerInHand {
  playerId: string;
  seatIndex: number;
  agentId: string;
  stackBefore: number;
  stack: number;
  status: PlayerStatus;
  totalBetInHand: number;
  currentRoundBet: number;
  holeCards: [Card, Card] | null;
}

export interface PublicPlayer {
  playerId: string;
  seatIndex: number;
  stack: number;
  status: PlayerStatus;
  totalBetInHand: number;
  currentRoundBet: number;
}

export interface GameAction {
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

export interface BettingRoundState {
  handId: string;
  phase: HandPhase;
  players: PlayerInHand[];
  currentActorIndex: number;
  currentRoundMinBet: number;
  minRaiseAmount: number;
  lastAggressorIndex: number | null;
  roundActions: GameAction[];
}

export interface GameState {
  handId: string;
  tableId: string;
  phase: HandPhase;
  deck: Deck;
  players: PlayerInHand[];
  communityCards: Card[];
  pots: Pot[];
  button: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  currentBettingRound: BettingRoundState | null;
  allActions: GameAction[];
  handNumber: number;
  seed: string;
}

export interface PublicGameState {
  handId: string;
  tableId: string;
  phase: HandPhase;
  players: PublicPlayer[];
  communityCards: Card[];
  pots: Pot[];
  button: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  currentActorIndex: number;
  currentRoundMinBet: number;
  minRaiseAmount: number;
  allActions: GameAction[];
}

export interface PrivatePlayerState {
  playerId: string;
  holeCards: [Card, Card];
}

export interface AgentDecisionRequest {
  requestId: string;
  handId: string;
  tableId: string;
  agentId: string;
  publicState: PublicGameState;
  privateState: PrivatePlayerState;
  legalActions: LegalAction[];
  timeoutMs: number;
}

export interface ReasoningConsideredAction {
  actionType: ActionType;
  amount?: number;
  reason: string;
}

export interface ReasoningSummary {
  intent: ReasoningIntent;
  confidence: number;
  riskLevel: ReasoningRiskLevel;
  keyObservations: string[];
  consideredActions: ReasoningConsideredAction[];
}

export interface AgentDecisionResponse {
  requestId: string;
  agentId: string;
  actionType: ActionType;
  amount?: number;
  reasoningSummary?: ReasoningSummary;
}

export interface DecisionTraceAction {
  actionType: ActionType;
  amount?: number;
}

export interface DecisionTraceAppliedAction {
  actionType: ActionType;
  amount: number;
  fallbackReason?: DecisionTraceFallbackReason;
}

export interface DecisionTrace {
  traceId: string;
  matchId: string;
  handId: string;
  actionId: string | null;
  requestId: string;
  agentId: string;
  playerId: string;
  phase: DecisionTracePhase;
  publicStateHash: string;
  privateStateHash: string;
  legalActions: LegalAction[];
  responseAction: DecisionTraceAction | null;
  appliedAction: DecisionTraceAppliedAction;
  latencyMs: number;
  timedOut: boolean;
  invalidReason: string | null;
  reasoningSummary: ReasoningSummary | null;
  createdAt: number;
}

export interface HandEvaluation {
  category: HandRankCategory;
  categoryRank: number;
  tiebreakers: number[];
  bestCards: [Card, Card, Card, Card, Card];
  description: string;
}

export interface BlindConfig {
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export interface TableConfig {
  tableId: string;
  name: string;
  maxSeats: number;
  blindConfig: BlindConfig;
  defaultTimeoutMs: number;
  seed?: string;
  maxSpectators?: number;
}

export interface SeatInfo {
  seatIndex: number;
  agentId: string;
  playerId: string;
  stack: number;
  status: PlayerStatus;
  ownerUserId: string;
  adapterType: SeatAdapterType;
  agentConfigId: string | null;
  sitOutNextHand: boolean;
  joinedAt: number;
}

export interface TableState {
  tableId: string;
  config: TableConfig;
  status: TableStatus;
  seats: (SeatInfo | null)[];
  currentHandId: string | null;
  handNumber: number;
  button: number;
  createdAt: number;
}

export interface AgentInfo {
  agentId: string;
  name: string;
  adapterType: AgentAdapterType;
  endpoint?: string;
  metadata?: Record<string, string>;
  registeredAt: number;
}

export interface HandPlayerSummary {
  playerId: string;
  agentId: string;
  seatIndex: number;
  stackBefore: number;
  stackAfter: number;
  holeCards: [Card, Card];
  handEvaluation?: HandEvaluation;
}

export type PublicHandPlayerSummary = Omit<HandPlayerSummary, 'holeCards' | 'handEvaluation'>;

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
  players: HandPlayerSummary[];
  blindConfig: BlindConfig;
  communityCards: Card[];
  allActions: GameAction[];
  results: HandResult[];
  finalPots: Pot[];
}

export type PublicHandSummary = Omit<HandSummary, 'players'> & {
  players: PublicHandPlayerSummary[];
};

export interface ReplayEvent {
  eventId: string;
  handId: string;
  tableId: string;
  sequence: number;
  eventType: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface MatchArtifactFileRef {
  path: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface AnalysisMetricSummary {
  decisionCount: number;
  actionCounts: Partial<Record<ActionType, number>>;
  streetCounts: Partial<Record<DecisionTracePhase, Partial<Record<ActionType, number>>>>;
  intentCounts: Partial<Record<ReasoningIntent, number>>;
  riskCounts: Partial<Record<ReasoningRiskLevel, number>>;
  missingReasoningCount: number;
  timeoutCount: number;
  invalidActionCount: number;
  fallbackCount: number;
  averageConfidence: number | null;
  averageLatencyMs: number | null;
  maxLatencyMs: number | null;
}

export interface AgentAnalysisSummary extends AnalysisMetricSummary {
  agentId: string;
  playerIds: string[];
  handIds: string[];
}

export interface MatchAnalysisSummary {
  matchId: string;
  tableId: string;
  generatedAt: number;
  handCount: number;
  agentCount: number;
  decisionCount: number;
  totals: AnalysisMetricSummary;
  agents: AgentAnalysisSummary[];
}

export interface MatchSummary {
  matchId: string;
  tableId: string;
  name: string;
  seed: string;
  startedAt: number;
  completedAt: number;
  handIds: string[];
  hands: PublicHandSummary[];
  finalStacks: Record<string, number>;
  agentIds: string[];
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

export interface MatchArtifactIndexEntry {
  matchId: string;
  tableId: string;
  name: string;
  seed: string;
  handCount: number;
  agentIds: string[];
  startedAt: number;
  completedAt: number;
  createdAt: number;
  artifactPath: string;
}

export interface MatchArtifactRecord {
  manifest: MatchArtifactManifest;
  summary: MatchSummary;
  replayEvents: ReplayEvent[];
  decisionTraces: DecisionTrace[];
  analysisSummary: MatchAnalysisSummary;
}
