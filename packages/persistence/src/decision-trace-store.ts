import { ArtifactLimitExceededError, type DecisionTrace, type LegalAction } from '@agent-poker/shared';
import { safePathSegment } from './match-artifact-serialization.js';
import type { IObjectStore } from './object-store.js';

export interface DecisionTraceStoreLimits {
  maxTraceBytes: number;
  maxMatchTraceBytes: number;
  maxTracesPerMatch: number;
}

export interface IDecisionTraceStore {
  appendDecisionTrace(trace: DecisionTrace): Promise<DecisionTrace>;
  listDecisionTraces(matchId: string): Promise<DecisionTrace[]>;
}

const DEFAULT_DECISION_TRACE_STORE_LIMITS: DecisionTraceStoreLimits = {
  maxTraceBytes: 8 * 1024,
  maxMatchTraceBytes: 512 * 1024,
  maxTracesPerMatch: 1000,
};

export class MemoryDecisionTraceStore implements IDecisionTraceStore {
  private readonly traces = new Map<string, DecisionTrace[]>();
  private readonly limits: DecisionTraceStoreLimits;

  constructor(limits: Partial<DecisionTraceStoreLimits> = {}) {
    this.limits = { ...DEFAULT_DECISION_TRACE_STORE_LIMITS, ...limits };
  }

  async appendDecisionTrace(trace: DecisionTrace): Promise<DecisionTrace> {
    const publicTrace = toPublicDecisionTrace(trace);
    const matchId = safePathSegment(publicTrace.matchId);
    const existing = this.traces.get(matchId) ?? [];
    const next = [...existing, publicTrace];
    assertWithinLimits(publicTrace, next, this.limits);
    this.traces.set(matchId, next.map(cloneDecisionTrace));
    return cloneDecisionTrace(publicTrace);
  }

  async listDecisionTraces(matchId: string): Promise<DecisionTrace[]> {
    const safeMatchId = safePathSegment(matchId);
    return (this.traces.get(safeMatchId) ?? []).map(cloneDecisionTrace);
  }
}

export class ObjectDecisionTraceStore implements IDecisionTraceStore {
  private readonly limits: DecisionTraceStoreLimits;

  constructor(
    private readonly objectStore: IObjectStore,
    limits: Partial<DecisionTraceStoreLimits> = {},
  ) {
    this.limits = { ...DEFAULT_DECISION_TRACE_STORE_LIMITS, ...limits };
  }

  async appendDecisionTrace(trace: DecisionTrace): Promise<DecisionTrace> {
    const publicTrace = toPublicDecisionTrace(trace);
    const matchId = safePathSegment(publicTrace.matchId);
    const existing = await this.listDecisionTraces(matchId);
    const next = [...existing, publicTrace];
    assertWithinLimits(publicTrace, next, this.limits);

    await this.objectStore.putText({
      key: traceObjectKey(matchId),
      body: serializeDecisionTraces(next),
      contentType: 'application/x-ndjson',
    });

    return cloneDecisionTrace(publicTrace);
  }

  async listDecisionTraces(matchId: string): Promise<DecisionTrace[]> {
    const safeMatchId = safePathSegment(matchId);
    const raw = await this.objectStore.getText(traceObjectKey(safeMatchId));
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => toPublicDecisionTrace(JSON.parse(line) as DecisionTrace));
  }
}

export function serializeDecisionTraces(traces: DecisionTrace[]): string {
  return traces.map(trace => JSON.stringify(toPublicDecisionTrace(trace))).join('\n') +
    (traces.length > 0 ? '\n' : '');
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

function assertWithinLimits(
  trace: DecisionTrace,
  traces: DecisionTrace[],
  limits: DecisionTraceStoreLimits,
): void {
  const traceBytes = Buffer.byteLength(`${JSON.stringify(trace)}\n`, 'utf-8');
  if (traceBytes > limits.maxTraceBytes) {
    throw new ArtifactLimitExceededError(
      `Decision trace is ${traceBytes} bytes; limit is ${limits.maxTraceBytes}`,
    );
  }

  if (traces.length > limits.maxTracesPerMatch) {
    throw new ArtifactLimitExceededError(
      `Decision trace count is ${traces.length}; limit is ${limits.maxTracesPerMatch}`,
    );
  }

  const matchBytes = Buffer.byteLength(serializeDecisionTraces(traces), 'utf-8');
  if (matchBytes > limits.maxMatchTraceBytes) {
    throw new ArtifactLimitExceededError(
      `Decision trace artifact is ${matchBytes} bytes; limit is ${limits.maxMatchTraceBytes}`,
    );
  }
}

function traceObjectKey(matchId: string): string {
  return `matches/${safePathSegment(matchId)}/decision-trace.jsonl`;
}

function cloneDecisionTrace(trace: DecisionTrace): DecisionTrace {
  return JSON.parse(JSON.stringify(toPublicDecisionTrace(trace))) as DecisionTrace;
}
