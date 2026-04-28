export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Suit = 'c' | 'd' | 'h' | 's';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';
export type HandPhase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type TableStatus = 'preparing' | 'in_hand' | 'paused' | 'completed';
export type SeatAdapterType = 'human' | 'http' | 'mock';

export interface BlindConfig {
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export interface LegalAction {
  type: ActionType;
  callAmount?: number;
  minAmount?: number;
  maxAmount?: number;
}

export interface SeatSnapshot {
  seatIndex: number;
  agentId: string;
  playerId: string;
  stack: number;
  status: string;
  ownerUserId: string;
  adapterType: SeatAdapterType;
  agentConfigId: string | null;
  sitOutNextHand: boolean;
  joinedAt: number;
}

export interface TableSnapshot {
  tableId: string;
  config: {
    name: string;
    maxSeats: number;
    blindConfig: BlindConfig;
    defaultTimeoutMs: number;
  };
  status: TableStatus;
  seats: (SeatSnapshot | null)[];
  currentHandId: string | null;
  handNumber: number;
  button: number;
}

export interface LiveSeatView {
  seatIndex: number;
  occupied: boolean;
  playerId: string | null;
  agentId: string | null;
  ownerUserId: string | null;
  adapterType: SeatAdapterType | null;
  stack: number | null;
  status: string | null;
  isButton: boolean;
  isCurrentActor: boolean;
  isMe: boolean;
  holeCards: [Card, Card] | null;
}

export interface PendingAction {
  handId: string;
  requestId: string;
  legalActions: LegalAction[];
  deadlineAt: number;
  privateState: { playerId: string; holeCards: [Card, Card] };
}

export interface LivePotView {
  amount: number;
}

export interface LiveActionLogEntry {
  id: string;
  label: string;
}

export interface LiveTableViewState {
  tableId: string | null;
  tableName: string;
  status: TableStatus | null;
  blindConfig: BlindConfig | null;
  handId: string | null;
  handNumber: number;
  phase: HandPhase | null;
  buttonSeatIndex: number;
  seats: LiveSeatView[];
  board: Card[];
  pots: LivePotView[];
  currentActorPlayerId: string | null;
  actionLog: LiveActionLogEntry[];
  pendingAction: PendingAction | null;
  connectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'closed';
}

export type LiveTableEvent =
  | { type: 'snapshot.loaded'; table: TableSnapshot; meUserId: string | null }
  | { type: 'connection.changed'; status: LiveTableViewState['connectionStatus'] }
  | { type: 'hand.started'; handId?: string; handNumber: number }
  | {
      type: 'table.hole_cards_revealed';
      handId: string;
      playerId: string;
      seatIndex: number;
      agentId: string;
      holeCards: [Card, Card];
    }
  | {
      type: 'seat.hole_cards';
      handId: string;
      playerId: string;
      seatIndex: number;
      agentId: string;
      holeCards: [Card, Card];
    }
  | { type: 'community_cards.dealt'; phase: HandPhase; cards: Card[] }
  | { type: 'action.requested'; playerId: string }
  | {
      type: 'seat.action_requested';
      handId: string;
      requestId: string;
      legalActions: LegalAction[];
      deadlineAt: number;
      privateState: { playerId: string; holeCards: [Card, Card] };
    }
  | { type: 'action.applied'; playerId: string; actionType: ActionType; amount: number; potTotal?: number }
  | { type: 'betting_round.complete'; pots: LivePotView[] }
  | { type: 'pot.awarded'; amount: number; winnerIds: string[] }
  | { type: 'hand.completed' };
