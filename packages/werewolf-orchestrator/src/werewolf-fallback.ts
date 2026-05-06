import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';

// Domain-specific fallback for TimeoutHandler<WerewolfDecisionRequest, WerewolfDecisionResponse>.
// Picks the FIRST valid action — this guarantees deterministic, valid behaviour
// when an agent times out, throws, or returns an action that is not in
// validActions. Throws when validActions is empty; the caller (the runner)
// must avoid invoking the fallback for a player with no valid action.
export function werewolfFallback(
  req: WerewolfDecisionRequest,
): WerewolfDecisionResponse {
  const first = req.validActions[0];
  if (!first) {
    throw new Error(
      `werewolfFallback: no valid action available for player ${req.playerId} in phase ${req.phase}`,
    );
  }
  return {
    requestId: req.requestId,
    agentId: req.agentId,
    action: first,
  };
}
