import { ArtifactLimitExceededError, type DecisionTrace } from '@agent-poker/shared';
import {
  parseDecisionTraces,
  serializeDecisionTraces,
  toPublicDecisionTrace,
} from './decision-trace-serialization.js';
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
    return parseDecisionTraces(raw);
  }
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
