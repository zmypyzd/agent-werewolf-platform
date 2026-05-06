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
  | 'completion'
  | 'reason';   // indented reasoning line, subordinate to the speak entry above it

export interface WerewolfTimelineLine {
  id: string;
  kind: WerewolfTimelineLineKind;
  text: string;
  timestamp: number;
  sub?: string;   // performance descriptor shown below speech text on 'speak' entries
}

// The most recent day-phase speech, surfaced as a "broadcast booth" panel in
// the center of the table. Persists across the brief gap between speakers
// (when speakingActor is briefly unset while the next agent is being
// requested) so spectators can finish reading. Cleared on phase change.
export interface CurrentSpeech {
  actorId: string;
  text: string;
  performance?: string;
  intent?: string;
}

export interface WerewolfRoomState {
  gameId: string;
  status: 'waiting' | 'ready' | 'running' | 'completed' | 'failed';
  seats: SeatVM[];
  currentPhase: WerewolfPhase | 'pre-match' | 'completed';
  dayNumber: number;
  nightNumber: number;
  thinkingActor?: string | undefined;   // set on agent.action_requested, cleared on action_received
  speakingActor?: string | undefined;   // set on agent.action_received (speak), cleared on phase.changed
  currentSpeech?: CurrentSpeech | undefined;
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
