import type {
  WerewolfAction,
  WerewolfDecisionRequest,
  WerewolfPlayerId,
  WerewolfPublicState,
  WerewolfPrivateState,
} from '@agent-poker/shared';

export interface BuildWerewolfDecisionRequestInput {
  readonly requestId: string;
  readonly gameId: string;
  readonly agentId: string;
  readonly playerId: WerewolfPlayerId;
  readonly publicState: WerewolfPublicState;
  readonly privateState: WerewolfPrivateState;
  readonly validActions: ReadonlyArray<WerewolfAction>;
  readonly deadlineMs: number;
}

export function buildWerewolfDecisionRequest(
  input: BuildWerewolfDecisionRequestInput,
): WerewolfDecisionRequest {
  if (input.publicState.gameId !== input.gameId) {
    throw new Error(
      `gameId mismatch: input.gameId=${input.gameId} vs publicState.gameId=${input.publicState.gameId}`,
    );
  }
  if (input.privateState.selfId !== input.playerId) {
    throw new Error(
      `playerId mismatch: input.playerId=${input.playerId} vs privateState.selfId=${input.privateState.selfId}`,
    );
  }
  return {
    requestId: input.requestId,
    gameId: input.gameId,
    agentId: input.agentId,
    playerId: input.playerId,
    phase: input.publicState.phase,
    nightNumber: input.publicState.nightNumber,
    dayNumber: input.publicState.dayNumber,
    publicState: input.publicState,
    privateState: input.privateState,
    validActions: input.validActions,
    deadlineMs: input.deadlineMs,
  };
}
