import type { DecisionTrace, LegalAction } from '@agent-poker/shared';

export function serializeDecisionTraces(traces: DecisionTrace[]): string {
  return traces.map(trace => JSON.stringify(toPublicDecisionTrace(trace))).join('\n') +
    (traces.length > 0 ? '\n' : '');
}

export function parseDecisionTraces(raw: string): DecisionTrace[] {
  return raw
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => toPublicDecisionTrace(JSON.parse(line) as DecisionTrace));
}

export function toPublicDecisionTrace(trace: DecisionTrace): DecisionTrace {
  return {
    traceId: trace.traceId,
    matchId: trace.matchId,
    handId: trace.handId,
    actionId: trace.actionId ?? null,
    requestId: trace.requestId,
    agentId: trace.agentId,
    playerId: trace.playerId,
    phase: trace.phase,
    publicStateHash: trace.publicStateHash,
    privateStateHash: trace.privateStateHash,
    legalActions: trace.legalActions.map(toPublicLegalAction),
    responseAction: trace.responseAction
      ? {
          actionType: trace.responseAction.actionType,
          ...(trace.responseAction.amount !== undefined ? { amount: trace.responseAction.amount } : {}),
        }
      : null,
    appliedAction: {
      actionType: trace.appliedAction.actionType,
      amount: trace.appliedAction.amount,
      ...(trace.appliedAction.fallbackReason !== undefined
        ? { fallbackReason: trace.appliedAction.fallbackReason }
        : {}),
    },
    latencyMs: trace.latencyMs,
    timedOut: trace.timedOut,
    invalidReason: trace.invalidReason ?? null,
    reasoningSummary: trace.reasoningSummary
      ? {
          intent: trace.reasoningSummary.intent,
          confidence: trace.reasoningSummary.confidence,
          riskLevel: trace.reasoningSummary.riskLevel,
          keyObservations: [...trace.reasoningSummary.keyObservations],
          consideredActions: trace.reasoningSummary.consideredActions.map(action => ({
            actionType: action.actionType,
            ...(action.amount !== undefined ? { amount: action.amount } : {}),
            reason: action.reason,
          })),
        }
      : null,
    createdAt: trace.createdAt,
  };
}

function toPublicLegalAction(action: LegalAction): LegalAction {
  return {
    type: action.type,
    ...(action.callAmount !== undefined ? { callAmount: action.callAmount } : {}),
    ...(action.minAmount !== undefined ? { minAmount: action.minAmount } : {}),
    ...(action.maxAmount !== undefined ? { maxAmount: action.maxAmount } : {}),
  };
}
