import type { WerewolfDecisionTrace } from '@agent-poker/shared';

export function serializeWerewolfDecisionTraces(traces: WerewolfDecisionTrace[]): string {
  return (
    traces.map((t) => JSON.stringify(toPublicWerewolfDecisionTrace(t))).join('\n') +
    (traces.length > 0 ? '\n' : '')
  );
}

export function parseWerewolfDecisionTraces(raw: string): WerewolfDecisionTrace[] {
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => toPublicWerewolfDecisionTrace(JSON.parse(line) as WerewolfDecisionTrace));
}

// Public projection — the trace is already public-safe in this design (no
// holeCard equivalent), so this currently round-trips. It exists as a single
// place to evolve the public contract (e.g. drop reasoningSummary entirely,
// trim observation lengths) without touching every store impl.
export function toPublicWerewolfDecisionTrace(
  trace: WerewolfDecisionTrace,
): WerewolfDecisionTrace {
  return {
    traceId: trace.traceId,
    matchId: trace.matchId,
    sequence: trace.sequence,
    requestId: trace.requestId,
    agentId: trace.agentId,
    playerId: trace.playerId,
    phase: trace.phase,
    nightNumber: trace.nightNumber,
    dayNumber: trace.dayNumber,
    publicStateHash: trace.publicStateHash,
    privateStateHash: trace.privateStateHash,
    validActionTypes: [...trace.validActionTypes],
    responseAction: trace.responseAction,
    appliedAction: trace.appliedAction,
    latencyMs: trace.latencyMs,
    timedOut: trace.timedOut,
    invalidReason: trace.invalidReason,
    fallbackReason: trace.fallbackReason,
    reasoningSummary: trace.reasoningSummary
      ? {
          intent: trace.reasoningSummary.intent,
          confidence: trace.reasoningSummary.confidence,
          keyObservations: [...trace.reasoningSummary.keyObservations],
        }
      : null,
    createdAt: trace.createdAt,
  };
}
