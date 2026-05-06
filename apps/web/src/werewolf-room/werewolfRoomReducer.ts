import {
  type CurrentSpeech,
  type SeatVM,
  type WerewolfPhase,
  type WerewolfReplayEvent,
  type WerewolfRole,
  type WerewolfRoomState,
  type WerewolfSide,
  type WerewolfTimelineLine,
} from './werewolfRoomTypes.js';
import {
  normalizeWerewolfReplayEvent,
  type NameIndex,
} from './normalizeWerewolfReplayEvent.js';

interface ServerLobbyEntry {
  gameId: string;
  name: string;
  status: 'waiting' | 'ready' | 'running' | 'completed' | 'failed';
  seats: Array<{
    seatIndex: number;
    playerId: string;
    occupant:
      | { kind: 'empty' }
      | { kind: 'npc'; agentId: string; displayName: string };
  }>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  winner?: WerewolfSide;
  failureReason?: string;
  finalPlayers?: ReadonlyArray<{
    id: string;
    seatIndex: number;
    name: string;
    role: string;
    side: WerewolfSide;
    alive: boolean;
  }>;
}

export type WerewolfRoomAction =
  | { type: 'lobby-sync'; entry: ServerLobbyEntry }
  | { type: 'replay-event'; event: WerewolfReplayEvent }
  | {
      type: 'match-completed';
      winner: WerewolfSide;
      finalPlayers: ReadonlyArray<{
        id: string;
        seatIndex: number;
        name: string;
        role: string;
        side: WerewolfSide;
        alive: boolean;
      }>;
    }
  | { type: 'match-failed'; reason: string };

const NIGHT_PHASE_PREFIX = 'night-';

function isNightPhase(phase: string | WerewolfPhase | undefined): boolean {
  return typeof phase === 'string' && phase.startsWith(NIGHT_PHASE_PREFIX);
}

function nameIndexFromSeats(seats: SeatVM[]): NameIndex {
  const out: Record<string, string> = {};
  for (const s of seats) {
    if (s.occupant.kind === 'npc') out[s.playerId] = s.occupant.displayName;
    else out[s.playerId] = s.playerId;
  }
  return out;
}

export function werewolfRoomReducer(
  state: WerewolfRoomState,
  action: WerewolfRoomAction,
): WerewolfRoomState {
  if (action.type === 'lobby-sync') {
    const seats: SeatVM[] = action.entry.seats.map((s) => ({
      seatIndex: s.seatIndex,
      playerId: s.playerId,
      occupant: s.occupant,
      alive: true,
    }));
    return {
      ...state,
      gameId: action.entry.gameId,
      status: action.entry.status,
      seats,
      ...(action.entry.failureReason
        ? { failureReason: action.entry.failureReason }
        : {}),
    };
  }

  if (action.type === 'match-completed') {
    const seats = state.seats.map((s) => {
      const fp = action.finalPlayers.find((p) => p.seatIndex === s.seatIndex);
      if (!fp) return s;
      return {
        ...s,
        alive: fp.alive,
        revealedRole: fp.role as WerewolfRole,
        revealedSide: fp.side,
      };
    });
    return {
      ...state,
      status: 'completed',
      winner: action.winner,
      currentPhase: 'completed',
      thinkingActor: undefined,
      speakingActor: undefined,
      currentSpeech: undefined,
      seats,
    };
  }

  if (action.type === 'match-failed') {
    return { ...state, status: 'failed', failureReason: action.reason };
  }

  // replay-event
  const event = action.event;
  const names = nameIndexFromSeats(state.seats);
  const phase = (event.data['phase'] as string | undefined) ?? state.currentPhase;
  let next: WerewolfRoomState = state;

  if (event.eventType === 'phase.changed') {
    const newPhase = event.data['phase'] as WerewolfPhase | undefined;
    if (newPhase) {
      // Apply eliminations carried by this phase transition: night deaths
      // land on the day-announce transition, banishments land on whatever
      // phase follows day-resolve, hunter shots land on whatever follows
      // hunter-shoot. The orchestrator surfaces them as event.data.eliminated
      // (see packages/werewolf-orchestrator/src/match-runner.ts).
      const eliminatedRaw = event.data['eliminated'];
      const eliminated: ReadonlyArray<{ playerId: string; cause: string }> =
        Array.isArray(eliminatedRaw)
          ? eliminatedRaw.filter(
              (e): e is { playerId: string; cause: string } =>
                typeof e === 'object' &&
                e !== null &&
                typeof (e as Record<string, unknown>)['playerId'] === 'string' &&
                typeof (e as Record<string, unknown>)['cause'] === 'string',
            )
          : [];
      const seatsAfterDeaths =
        eliminated.length > 0
          ? next.seats.map((s) =>
              eliminated.some((e) => e.playerId === s.playerId)
                ? { ...s, alive: false }
                : s,
            )
          : next.seats;

      next = {
        ...next,
        currentPhase: newPhase,
        seats: seatsAfterDeaths,
        nightNumber:
          typeof event.data['nightNumber'] === 'number'
            ? (event.data['nightNumber'] as number)
            : next.nightNumber,
        dayNumber:
          typeof event.data['dayNumber'] === 'number'
            ? (event.data['dayNumber'] as number)
            : next.dayNumber,
        thinkingActor: undefined,
        speakingActor: undefined,
        currentSpeech: undefined,
      };
    }
  }

  if (event.eventType === 'agent.action_requested') {
    if (!isNightPhase(phase)) {
      const pid = event.data['playerId'];
      if (typeof pid === 'string') {
        next = { ...next, thinkingActor: pid, speakingActor: undefined };
      }
    }
  }

  if (event.eventType === 'agent.action_received') {
    const actionData = event.data['action'] as
      | { type?: string; speech?: string; performance?: string }
      | undefined;
    const pid = event.data['playerId'];
    const reasoning = event.data['reasoningSummary'] as
      | { intent?: string }
      | undefined;
    if (actionData?.type === 'speak' && typeof pid === 'string' && !isNightPhase(phase)) {
      const speech: CurrentSpeech = {
        actorId: pid,
        text: actionData.speech ?? '',
        ...(actionData.performance ? { performance: actionData.performance } : {}),
        ...(reasoning?.intent ? { intent: reasoning.intent } : {}),
      };
      next = {
        ...next,
        thinkingActor: undefined,
        speakingActor: pid,
        currentSpeech: speech,
      };
    } else {
      // Non-speak action (vote, etc.) — clear speakingActor but KEEP currentSpeech
      // so spectators can finish reading the last speech while voting starts.
      // currentSpeech is cleared on phase.changed.
      next = { ...next, thinkingActor: undefined, speakingActor: undefined };
    }
  }

  if (event.eventType === 'match.completed') {
    const w = event.data['winner'];
    if (w === 'good' || w === 'werewolf') {
      next = {
        ...next,
        status: 'completed',
        currentPhase: 'completed',
        thinkingActor: undefined,
        speakingActor: undefined,
        currentSpeech: undefined,
        winner: w,
      };
    }
  }

  const lines = normalizeWerewolfReplayEvent(event, names);

  if (lines.length === 0) {
    if (isNightPhase(phase)) {
      const last = next.timeline[next.timeline.length - 1];
      if (
        last &&
        last.kind === 'system-night-fold' &&
        last.text.includes(`夜 ${next.nightNumber}`)
      ) {
        return next;
      }
      const fold: WerewolfTimelineLine = {
        id: `night-fold-${next.nightNumber}-${event.eventId}`,
        kind: 'system-night-fold',
        text: `🌙 夜 ${next.nightNumber} · 行动中…`,
        timestamp: event.timestamp,
      };
      return { ...next, timeline: [...next.timeline, fold] };
    }
    return next;
  }

  return { ...next, timeline: [...next.timeline, ...lines] };
}
