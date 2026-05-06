import type { WerewolfAction, WerewolfPhase, WerewolfPlayerId } from './werewolf-types.js';
import type { WerewolfReasoningSummary } from './werewolf-decision-types.js';

export type { WerewolfReasoningSummary };

export type WerewolfDecisionTraceFallbackReason =
  | 'timeout'
  | 'invalid_action'
  | 'missing_agent';

// Action-payload shape stored on a public trace. Every night-phase action
// drops fields that would identify either the actor's role or the target
// of a private night decision; the recorder strips these before persistence.
//
// Specifically:
//   - werewolf-vote: drops voterId + targetId (only werewolves vote, and
//     the chosen target is private to the pack)
//   - witch-save / witch-poison / seer-divine: drops targetId (the target
//     reveals who the role acted on, mirroring the night-action history
//     drop in toPublicWerewolfHistory)
//   - speak: drops inner (心声 — engine-level private)
//   - day-vote / hunter-shoot: public actions, all fields preserved
export type WerewolfDecisionTraceAction =
  | { readonly type: 'werewolf-vote' }
  | { readonly type: 'witch-save' }
  | { readonly type: 'witch-skip-save' }
  | { readonly type: 'witch-poison' }
  | { readonly type: 'witch-skip-poison' }
  | { readonly type: 'seer-divine' }
  | {
      readonly type: 'speak';
      readonly playerId: WerewolfPlayerId;
      readonly performance: string;
      readonly speech: string;
    }
  | {
      readonly type: 'day-vote';
      readonly voterId: WerewolfPlayerId;
      readonly targetId: WerewolfPlayerId | null;
    }
  | {
      readonly type: 'hunter-shoot';
      readonly targetId: WerewolfPlayerId | null;
    };

export interface WerewolfDecisionTrace {
  readonly traceId: string;
  readonly matchId: string;
  // Monotonically increasing per match. Mirrors poker's reliance on
  // (handId, createdAt) ordering — werewolf has no handId, so a per-match
  // sequence number is the canonical ordering key.
  readonly sequence: number;
  readonly requestId: string;
  readonly agentId: string;
  readonly playerId: WerewolfPlayerId;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly publicStateHash: string;
  readonly privateStateHash: string;
  // Distilled valid-action list — full action payloads can carry IDs that
  // are private to the requesting agent (e.g. werewolf vote targets), so
  // we store only the action-type set. If a future analyzer needs more
  // detail, extend this with a payload-redacted shape.
  readonly validActionTypes: ReadonlyArray<WerewolfAction['type']>;
  readonly responseAction: WerewolfDecisionTraceAction | null;
  readonly appliedAction: WerewolfDecisionTraceAction;
  readonly latencyMs: number;
  readonly timedOut: boolean;
  readonly invalidReason: string | null;
  readonly fallbackReason: WerewolfDecisionTraceFallbackReason | null;
  readonly reasoningSummary: WerewolfReasoningSummary | null;
  readonly createdAt: number;
}
