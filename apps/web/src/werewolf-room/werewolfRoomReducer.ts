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
    // ISSUE-005 follow-up: server populates these once status flips to
    // 'running' or 'completed'. Pre-start the fields are absent.
    role?: string;
    side?: WerewolfSide;
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

const KNOWN_CAUSES = ['wolf-kill', 'witch-poison', 'banishment', 'hunter-shoot'] as const;
type KnownCause = (typeof KNOWN_CAUSES)[number];

function isKnownCause(cause: string): cause is KnownCause {
  return (KNOWN_CAUSES as readonly string[]).includes(cause);
}

const KNOWN_ROLES = ['werewolf', 'villager', 'seer', 'witch', 'hunter'] as const;
const KNOWN_SIDES = ['good', 'werewolf'] as const;

function isKnownRole(v: unknown): v is WerewolfRole {
  return typeof v === 'string' && (KNOWN_ROLES as readonly string[]).includes(v);
}

function isKnownSide(v: unknown): v is WerewolfSide {
  return typeof v === 'string' && (KNOWN_SIDES as readonly string[]).includes(v);
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
    // The server's lobby entry doesn't carry per-seat alive / revealedRole
    // — those are populated by replay events (phase.changed.eliminated[])
    // mid-match and by match-completed at end. Preserve them from the
    // existing state instead of resetting to alive:true on every 5-second
    // REST poll, which previously wiped deaths from the seat board the
    // moment the next poll fired.
    const previousByPlayerId = new Map(state.seats.map((s) => [s.playerId, s]));
    const seats: SeatVM[] = action.entry.seats.map((s) => {
      const prev = previousByPlayerId.get(s.playerId);
      // ISSUE-005 follow-up: when the server-side lobby entry carries
      // role/side (status='running' or 'completed'), the lobby-sync poll
      // is the actual delivery mechanism for the spectator broadcast view
      // — match.started fired before the WS subscribed and the topic
      // doesn't replay, so the fields piggyback on this 2-5s poll instead.
      // Prefer the freshly-arrived fields over the prior seat's; fall back
      // to the prior seat for stability across polls that drop them.
      const incomingRole = isKnownRole(s.role) ? s.role : undefined;
      const incomingSide = isKnownSide(s.side) ? s.side : undefined;
      const role = incomingRole ?? prev?.revealedRole;
      const side = incomingSide ?? prev?.revealedSide;
      return {
        seatIndex: s.seatIndex,
        playerId: s.playerId,
        occupant: s.occupant,
        alive: prev ? prev.alive : true,
        ...(prev?.causeOfDeath ? { causeOfDeath: prev.causeOfDeath } : {}),
        ...(role ? { revealedRole: role } : {}),
        ...(side ? { revealedSide: side } : {}),
      };
    });
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

  // ISSUE-005 — spectator broadcast view: match.started carries role+side
  // per player (orchestrator emits them on the public realtime topic; agents
  // never read this stream). Lift them onto SeatVM.revealedRole/Side so the
  // spectator surface reveals every role from t=0. Living seats then render
  // the role badge; dead seats keep the cause-of-death copy from ISSUE-004.
  if (event.eventType === 'match.started') {
    const playersRaw = event.data['players'];
    if (Array.isArray(playersRaw)) {
      const byId = new Map<string, { role?: WerewolfRole; side?: WerewolfSide }>();
      for (const p of playersRaw) {
        if (typeof p !== 'object' || p === null) continue;
        const rec = p as Record<string, unknown>;
        const id = rec['id'];
        if (typeof id !== 'string') continue;
        const role = isKnownRole(rec['role']) ? rec['role'] : undefined;
        const side = isKnownSide(rec['side']) ? rec['side'] : undefined;
        byId.set(id, {
          ...(role ? { role } : {}),
          ...(side ? { side } : {}),
        });
      }
      if (byId.size > 0) {
        next = {
          ...next,
          seats: next.seats.map((s) => {
            const reveal = byId.get(s.playerId);
            if (!reveal) return s;
            return {
              ...s,
              ...(reveal.role ? { revealedRole: reveal.role } : {}),
              ...(reveal.side ? { revealedSide: reveal.side } : {}),
            };
          }),
        };
      }
    }
  }

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
          ? next.seats.map((s) => {
              const death = eliminated.find((e) => e.playerId === s.playerId);
              if (!death) return s;
              const cause = isKnownCause(death.cause)
                ? death.cause
                : undefined;
              return {
                ...s,
                alive: false,
                ...(cause ? { causeOfDeath: cause } : {}),
              };
            })
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
