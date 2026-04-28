import type {
  LiveActionLogEntry,
  LiveSeatView,
  LiveTableEvent,
  LiveTableViewState,
  SeatSnapshot,
} from './liveTableTypes.js';

export function createInitialLiveTableState(): LiveTableViewState {
  return {
    tableId: null,
    tableName: '',
    status: null,
    blindConfig: null,
    handId: null,
    handNumber: 0,
    phase: null,
    buttonSeatIndex: -1,
    seats: [],
    board: [],
    pots: [],
    currentActorPlayerId: null,
    actionLog: [],
    pendingAction: null,
    connectionStatus: 'connecting',
  };
}

export function liveTableReducer(
  state: LiveTableViewState,
  event: LiveTableEvent,
): LiveTableViewState {
  switch (event.type) {
    case 'snapshot.loaded': {
      const seats = Array.from({ length: event.table.config.maxSeats }, (_, index) =>
        seatFromSnapshot(event.table.seats[index] ?? null, index, event.table.button, event.meUserId),
      );

      return {
        ...state,
        tableId: event.table.tableId,
        tableName: event.table.config.name,
        status: event.table.status,
        blindConfig: event.table.config.blindConfig,
        handId: event.table.currentHandId,
        handNumber: event.table.handNumber,
        buttonSeatIndex: event.table.button,
        seats: markCurrentActor(seats, state.currentActorPlayerId),
      };
    }
    case 'connection.changed':
      return { ...state, connectionStatus: event.status };
    case 'hand.started':
      return {
        ...state,
        handId: event.handId,
        handNumber: event.handNumber,
        phase: 'preflop',
        board: [],
        pots: [],
        currentActorPlayerId: null,
        pendingAction: null,
        actionLog: [],
        seats: state.seats.map(seat => ({ ...seat, isCurrentActor: false, holeCards: null })),
      };
    case 'table.hole_cards_revealed':
      return {
        ...state,
        seats: state.seats.map(seat =>
          seat.playerId === event.playerId || seat.seatIndex === event.seatIndex
            ? { ...seat, holeCards: event.holeCards }
            : seat,
        ),
      };
    case 'seat.hole_cards':
      return {
        ...state,
        seats: state.seats.map(seat => (seat.isMe ? { ...seat, holeCards: event.holeCards } : seat)),
      };
    case 'community_cards.dealt':
      return { ...state, phase: event.phase, board: [...state.board, ...event.cards] };
    case 'action.requested':
      return {
        ...state,
        currentActorPlayerId: event.playerId,
        seats: markCurrentActor(state.seats, event.playerId),
      };
    case 'seat.action_requested':
      return {
        ...state,
        pendingAction: {
          handId: event.handId,
          requestId: event.requestId,
          legalActions: event.legalActions,
          deadlineAt: event.deadlineAt,
          privateState: event.privateState,
        },
        seats: state.seats.map(seat =>
          seat.isMe ? { ...seat, holeCards: event.privateState.holeCards } : seat,
        ),
      };
    case 'action.applied':
      return {
        ...state,
        currentActorPlayerId: null,
        seats: markCurrentActor(state.seats, null),
        actionLog: appendLog(state.actionLog, formatActionApplied(event)),
      };
    case 'betting_round.complete':
      return { ...state, pots: event.pots };
    case 'pot.awarded':
      return {
        ...state,
        actionLog: appendLog(state.actionLog, `pot awarded ${event.amount} to ${event.winnerIds.join(', ')}`),
      };
    case 'hand.completed':
      return {
        ...state,
        phase: 'complete',
        currentActorPlayerId: null,
        pendingAction: null,
        seats: markCurrentActor(state.seats, null),
      };
    default:
      return state;
  }
}

function seatFromSnapshot(
  seat: SeatSnapshot | null,
  seatIndex: number,
  buttonSeatIndex: number,
  meUserId: string | null,
): LiveSeatView {
  if (!seat) {
    return {
      seatIndex,
      occupied: false,
      playerId: null,
      agentId: null,
      ownerUserId: null,
      adapterType: null,
      stack: null,
      status: null,
      isButton: buttonSeatIndex === seatIndex,
      isCurrentActor: false,
      isMe: false,
      holeCards: null,
    };
  }

  return {
    seatIndex,
    occupied: true,
    playerId: seat.playerId,
    agentId: seat.agentId,
    ownerUserId: seat.ownerUserId,
    adapterType: seat.adapterType,
    stack: seat.stack,
    status: seat.status,
    isButton: buttonSeatIndex === seatIndex,
    isCurrentActor: false,
    isMe: seat.ownerUserId === meUserId,
    holeCards: null,
  };
}

function markCurrentActor(seats: LiveSeatView[], playerId: string | null): LiveSeatView[] {
  return seats.map(seat => ({ ...seat, isCurrentActor: !!playerId && seat.playerId === playerId }));
}

function appendLog(entries: LiveActionLogEntry[], label: string): LiveActionLogEntry[] {
  return [...entries, { id: `${Date.now()}:${entries.length}`, label }].slice(-50);
}

function formatActionApplied(event: Extract<LiveTableEvent, { type: 'action.applied' }>): string {
  const amount = event.amount > 0 ? ` ${event.amount}` : '';
  const pot = event.potTotal === undefined ? '' : ` (pot ${event.potTotal})`;
  return `${event.playerId} ${event.actionType}${amount}${pot}`;
}
