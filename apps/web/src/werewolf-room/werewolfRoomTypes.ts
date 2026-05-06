// Local mirror of werewolf types from packages/shared. Webland keeps its
// own type defs (same pattern as live-table/liveTableTypes.ts) so the
// frontend doesn't depend on the shared workspace package.

export type WerewolfRole =
  | 'werewolf'
  | 'villager'
  | 'seer'
  | 'witch'
  | 'hunter';

export type WerewolfSide = 'good' | 'werewolf';

export type WerewolfPhase =
  | 'setup'
  | 'night-werewolf-vote'
  | 'night-witch'
  | 'night-seer'
  | 'night-resolve'
  | 'day-announce'
  | 'day-speeches'
  | 'day-vote'
  | 'day-resolve'
  | 'hunter-shoot'
  | 'game-over';

export type WerewolfReplayEventType =
  | 'match.started'
  | 'agent.action_requested'
  | 'agent.action_received'
  | 'agent.timeout'
  | 'agent.invalid_action'
  | 'engine.action_applied'
  | 'phase.changed'
  | 'match.completed';

export interface WerewolfReplayEvent {
  readonly eventId: string;
  readonly gameId: string;
  readonly sequence: number;
  readonly eventType: WerewolfReplayEventType;
  readonly timestamp: number;
  readonly data: Readonly<Record<string, unknown>>;
}

// Mirrors the server's WerewolfSeatInfo plus per-seat live UI state.
export interface SeatVM {
  seatIndex: number;
  playerId: string;
  occupant:
    | { kind: 'empty' }
    | { kind: 'npc'; agentId: string; displayName: string };
  alive: boolean;
  revealedRole?: WerewolfRole;
  revealedSide?: WerewolfSide;
}

export type WerewolfTimelineLineKind =
  | 'system'
  | 'phase-day'
  | 'phase-night'
  | 'speak'
  | 'vote'
  | 'system-night-fold'
  | 'completion';

export interface WerewolfTimelineLine {
  id: string;
  kind: WerewolfTimelineLineKind;
  text: string;
  timestamp: number;
}

export interface WerewolfRoomState {
  gameId: string;
  status: 'waiting' | 'ready' | 'running' | 'completed' | 'failed';
  seats: SeatVM[];
  currentPhase: WerewolfPhase | 'pre-match' | 'completed';
  dayNumber: number;
  nightNumber: number;
  currentActor?: string | undefined;
  timeline: WerewolfTimelineLine[];
  winner?: WerewolfSide;
  failureReason?: string;
}

export function emptyRoomState(gameId: string): WerewolfRoomState {
  return {
    gameId,
    status: 'waiting',
    seats: Array.from({ length: 9 }, (_, i) => ({
      seatIndex: i,
      playerId: `p${i + 1}`,
      occupant: { kind: 'empty' as const },
      alive: true,
    })),
    currentPhase: 'pre-match',
    dayNumber: 0,
    nightNumber: 0,
    timeline: [],
  };
}
