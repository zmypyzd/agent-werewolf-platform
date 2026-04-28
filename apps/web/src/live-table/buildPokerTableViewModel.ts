import type { Card, LiveSeatView, LiveTableViewState } from './liveTableTypes.js';

export type SeatPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left'
  | 'center-left';

export interface PokerTableSeatModel extends LiveSeatView {
  position: SeatPosition;
  displayName: string;
  identityLabel: string;
  adapterLabel: 'Human' | 'HTTP Agent' | 'Mock Agent' | null;
  isYou: boolean;
}

export interface VisibleHandModel {
  playerId: string;
  label: string;
  cards: [Card, Card] | null;
  cardStatus: 'visible' | 'cards pending';
}

export interface PokerTableViewModel {
  title: string;
  subtitle: string;
  phaseLabel: string;
  connectionStatus: LiveTableViewState['connectionStatus'];
  board: Card[];
  totalPot: number;
  seats: PokerTableSeatModel[];
  visibleHands: VisibleHandModel[];
  actionLog: LiveTableViewState['actionLog'];
  pendingAction: LiveTableViewState['pendingAction'];
  canShowSeatControls: boolean;
}

const POSITION_MAP: Record<number, SeatPosition[]> = {
  2: ['top-left', 'bottom-right'],
  3: ['top-left', 'right', 'bottom-left'],
  4: ['top-left', 'top-right', 'bottom-right', 'bottom-left'],
  5: ['top-left', 'top-right', 'right', 'bottom-right', 'bottom-left'],
  6: ['top-left', 'top-right', 'right', 'bottom-right', 'bottom-left', 'left'],
  7: ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom-left', 'left'],
  8: ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'],
  9: ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'center-left'],
};

export function buildPokerTableViewModel(
  state: LiveTableViewState,
  options: { seatable: boolean },
): PokerTableViewModel {
  const seats = state.seats.map((seat, index) => {
    const identityLabel = identityLabelForSeat(seat);

    return {
      ...seat,
      position: positionFor(state.seats.length, index),
      displayName: identityLabel,
      identityLabel,
      adapterLabel: adapterLabelFor(seat.adapterType),
      isYou: seat.isMe,
    };
  });
  const blindLabel = state.blindConfig ? `${state.blindConfig.smallBlind}/${state.blindConfig.bigBlind}` : '--';
  const phaseLabel = state.phase ?? 'waiting';
  const handLabel = state.handId ? `hand ${state.handId}` : 'no active hand';
  const showVisibleHands = state.handId !== null;

  return {
    title: state.tableName || 'Poker Table',
    subtitle: `${handLabel} · ${phaseLabel} · blinds ${blindLabel}`,
    phaseLabel,
    connectionStatus: state.connectionStatus,
    board: state.board,
    totalPot: state.pots.reduce((sum, pot) => sum + pot.amount, 0),
    seats,
    visibleHands: showVisibleHands ? seats
      .filter(seat => seat.occupied && seat.playerId)
      .map(seat => ({
        playerId: seat.playerId!,
        label: seat.displayName,
        cards: seat.holeCards,
        cardStatus: seat.holeCards ? 'visible' : 'cards pending',
      })) : [],
    actionLog: state.actionLog,
    pendingAction: state.pendingAction,
    canShowSeatControls: options.seatable,
  };
}

function positionFor(totalSeats: number, index: number): SeatPosition {
  const normalizedTotal = Math.min(9, Math.max(2, totalSeats));
  return (POSITION_MAP[normalizedTotal] ?? POSITION_MAP[9])![index] ?? 'center-left';
}

function identityLabelForSeat(seat: LiveSeatView): string {
  if (!seat.occupied) return `Seat ${seat.seatIndex + 1}`;
  return seat.agentId ?? seat.playerId ?? `Seat ${seat.seatIndex + 1}`;
}

function adapterLabelFor(adapterType: LiveSeatView['adapterType']): PokerTableSeatModel['adapterLabel'] {
  if (adapterType === 'http') return 'HTTP Agent';
  if (adapterType === 'mock') return 'Mock Agent';
  if (adapterType === 'human') return 'Human';
  return null;
}
