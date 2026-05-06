import { createHash, randomUUID } from 'crypto';
import type {
  WerewolfAction,
  WerewolfDecisionTrace,
  WerewolfDecisionTraceAction,
  WerewolfDecisionTraceFallbackReason,
  WerewolfPhase,
  WerewolfPlayerId,
  WerewolfPrivateState,
  WerewolfPublicState,
  WerewolfReasoningSummary,
} from '@agent-poker/shared';
import type { IWerewolfDecisionTraceStore } from '@agent-poker/persistence';

const INTENT_MAX = 200;
const OBSERVATION_MAX = 200;
const OBSERVATIONS_MAX = 10;

export interface RecordWerewolfDecisionTraceInput {
  readonly store: IWerewolfDecisionTraceStore;
  readonly matchId: string;
  readonly sequence: number;
  readonly requestId: string;
  readonly agentId: string;
  readonly playerId: WerewolfPlayerId;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly publicState: WerewolfPublicState;
  readonly privateState: WerewolfPrivateState;
  readonly validActions: ReadonlyArray<WerewolfAction>;
  readonly responseAction: WerewolfAction | null;
  readonly appliedAction: WerewolfAction;
  readonly latencyMs: number;
  readonly timedOut: boolean;
  readonly invalidReason: string | null;
  readonly fallbackReason: WerewolfDecisionTraceFallbackReason | null;
  readonly reasoningSummary?: WerewolfReasoningSummary;
  readonly now: number;
}

export async function recordWerewolfDecisionTrace(
  input: RecordWerewolfDecisionTraceInput,
): Promise<WerewolfDecisionTrace> {
  const trace: WerewolfDecisionTrace = {
    traceId: randomUUID(),
    matchId: input.matchId,
    sequence: input.sequence,
    requestId: input.requestId,
    agentId: input.agentId,
    playerId: input.playerId,
    phase: input.phase,
    nightNumber: input.nightNumber,
    dayNumber: input.dayNumber,
    publicStateHash: hashState(input.publicState),
    privateStateHash: hashState(input.privateState),
    validActionTypes: input.validActions.map((a) => a.type),
    responseAction: input.responseAction ? toTraceAction(input.responseAction) : null,
    appliedAction: toTraceAction(input.appliedAction),
    latencyMs: input.latencyMs,
    timedOut: input.timedOut,
    invalidReason: input.invalidReason,
    fallbackReason: input.fallbackReason,
    reasoningSummary: input.reasoningSummary ? capReasoning(input.reasoningSummary) : null,
    createdAt: input.now,
  };
  return input.store.appendDecisionTrace(trace);
}

function toTraceAction(action: WerewolfAction): WerewolfDecisionTraceAction {
  // Drop `inner` from speak — defense in depth even though sanitize-action
  // already strips it before broadcast.
  switch (action.type) {
    case 'speak':
      return {
        type: 'speak',
        playerId: action.playerId,
        performance: action.performance,
        speech: action.speech,
      };
    case 'werewolf-vote':
      // Drop voterId + targetId. Persisting them on the public trace would
      // identify the werewolf (only werewolves emit this action) and reveal
      // which player the pack chose to kill — both are private to the
      // werewolf coalition during the game and stay private in the artifact.
      return { type: 'werewolf-vote' };
    case 'witch-save':
    case 'witch-poison':
    case 'seer-divine':
      // Drop targetId for the same reason werewolf-vote does: the trace
      // is a public artifact, and the night-action history entry carrying
      // the same target was already filtered by toPublicWerewolfHistory.
      // The WerewolfDecisionTraceAction union enforces the strip at the
      // type level — no cast needed.
      return { type: action.type };
    case 'witch-skip-save':
    case 'witch-skip-poison':
      return { type: action.type };
    case 'day-vote':
      return { type: 'day-vote', voterId: action.voterId, targetId: action.targetId };
    case 'hunter-shoot':
      return { type: 'hunter-shoot', targetId: action.targetId };
  }
}

function capReasoning(r: WerewolfReasoningSummary): WerewolfReasoningSummary {
  return {
    intent: r.intent.slice(0, INTENT_MAX),
    confidence: r.confidence,
    keyObservations: r.keyObservations
      .slice(0, OBSERVATIONS_MAX)
      .map((s) => s.slice(0, OBSERVATION_MAX)),
  };
}

function hashState(state: unknown): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}
