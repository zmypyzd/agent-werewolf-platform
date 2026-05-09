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
// kind:'agent' represents a third-party HTTP agent backed by a registered
// UserAgentConfig. isMine is set true ONLY by the server when the GET
// /werewolf-games/:id requester is the agent's owner — never derived
// client-side. Plan decision D2/D5.
export interface SeatVM {
  seatIndex: number;
  playerId: string;
  occupant:
    | { kind: 'empty' }
    | { kind: 'npc'; agentId: string; displayName: string }
    | { kind: 'agent'; agentId: string; displayName: string; isMine?: true };
  alive: boolean;
  // How this seat died, propagated from event.data.eliminated[].cause on the
  // phase.changed that announced the death. Drives the seat status copy
  // (✝ 被狼刀 / ✝ 被毒 / ✝ 被放逐 / ✝ 被开枪) before match-completed
  // reveals the role. Absent on living seats and on legacy events that
  // didn't carry a cause.
  causeOfDeath?: 'wolf-kill' | 'witch-poison' | 'banishment' | 'hunter-shoot';
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
  // The most recent day-phase speech, captured by the reducer at
  // agent.action_received(speak) time and NOT cleared by phase.changed.
  // Exists separately from currentSpeech because SSE delivers the LAST
  // speaker's action_received and the immediately-following phase.changed
  // (day-speeches → day-vote, fired by the engine inside applySpeak when
  // pendingDaySpeeches reaches aliveCount) in the same network frame, so
  // React 18 batches both into one render. Without lastSpeech, the
  // intermediate currentSpeech=last-speaker state never makes it to a paint
  // and the broadcast booth appears to "skip" them. Components combine
  // currentSpeech (live) with a fading lastSpeech (replay) for display.
  // Cleared on match completion.
  lastSpeech?: CurrentSpeech | undefined;
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
