import { ArtifactLimitExceededError, type WerewolfDecisionTrace } from '@agent-poker/shared';
import {
  parseWerewolfDecisionTraces,
  serializeWerewolfDecisionTraces,
  toPublicWerewolfDecisionTrace,
} from './werewolf-decision-trace-serialization.js';
import { safePathSegment } from './match-artifact-serialization.js';
import type { IObjectStore } from './object-store.js';

export interface WerewolfDecisionTraceStoreLimits {
  maxTraceBytes: number;
  maxMatchTraceBytes: number;
  maxTracesPerMatch: number;
}

export interface IWerewolfDecisionTraceStore {
  appendDecisionTrace(trace: WerewolfDecisionTrace): Promise<WerewolfDecisionTrace>;
  listDecisionTraces(matchId: string): Promise<WerewolfDecisionTrace[]>;
}

export const DEFAULT_WEREWOLF_DECISION_TRACE_STORE_LIMITS: WerewolfDecisionTraceStoreLimits = {
  maxTraceBytes: 8 * 1024,
  maxMatchTraceBytes: 512 * 1024,
  maxTracesPerMatch: 1000,
};

export class MemoryWerewolfDecisionTraceStore implements IWerewolfDecisionTraceStore {
  private readonly traces = new Map<string, WerewolfDecisionTrace[]>();
  private readonly limits: WerewolfDecisionTraceStoreLimits;

  constructor(limits: Partial<WerewolfDecisionTraceStoreLimits> = {}) {
    this.limits = { ...DEFAULT_WEREWOLF_DECISION_TRACE_STORE_LIMITS, ...limits };
  }

  async appendDecisionTrace(
    trace: WerewolfDecisionTrace,
  ): Promise<WerewolfDecisionTrace> {
    const publicTrace = toPublicWerewolfDecisionTrace(trace);
    const matchId = safePathSegment(publicTrace.matchId);
    const existing = this.traces.get(matchId) ?? [];
    const next = [...existing, publicTrace];
    assertWithinLimits(publicTrace, next, this.limits);
    this.traces.set(matchId, next.map(cloneTrace));
    return cloneTrace(publicTrace);
  }

  async listDecisionTraces(matchId: string): Promise<WerewolfDecisionTrace[]> {
    return (this.traces.get(safePathSegment(matchId)) ?? []).map(cloneTrace);
  }
}

export class ObjectWerewolfDecisionTraceStore implements IWerewolfDecisionTraceStore {
  private readonly limits: WerewolfDecisionTraceStoreLimits;

  constructor(
    private readonly objectStore: IObjectStore,
    limits: Partial<WerewolfDecisionTraceStoreLimits> = {},
  ) {
    this.limits = { ...DEFAULT_WEREWOLF_DECISION_TRACE_STORE_LIMITS, ...limits };
  }

  async appendDecisionTrace(
    trace: WerewolfDecisionTrace,
  ): Promise<WerewolfDecisionTrace> {
    const publicTrace = toPublicWerewolfDecisionTrace(trace);
    const matchId = safePathSegment(publicTrace.matchId);
    const existing = await this.listDecisionTraces(matchId);
    const next = [...existing, publicTrace];
    assertWithinLimits(publicTrace, next, this.limits);

    await this.objectStore.putText({
      key: traceObjectKey(matchId),
      body: serializeWerewolfDecisionTraces(next),
      contentType: 'application/x-ndjson',
    });
    return cloneTrace(publicTrace);
  }

  async listDecisionTraces(matchId: string): Promise<WerewolfDecisionTrace[]> {
    const safe = safePathSegment(matchId);
    const raw = await this.objectStore.getText(traceObjectKey(safe));
    if (!raw) return [];
    return parseWerewolfDecisionTraces(raw);
  }
}

function assertWithinLimits(
  trace: WerewolfDecisionTrace,
  traces: WerewolfDecisionTrace[],
  limits: WerewolfDecisionTraceStoreLimits,
): void {
  const traceBytes = Buffer.byteLength(`${JSON.stringify(trace)}\n`, 'utf-8');
  if (traceBytes > limits.maxTraceBytes) {
    throw new ArtifactLimitExceededError(
      `Werewolf decision trace is ${traceBytes} bytes; limit is ${limits.maxTraceBytes}`,
    );
  }
  if (traces.length > limits.maxTracesPerMatch) {
    throw new ArtifactLimitExceededError(
      `Werewolf decision trace count is ${traces.length}; limit is ${limits.maxTracesPerMatch}`,
    );
  }
  const matchBytes = Buffer.byteLength(serializeWerewolfDecisionTraces(traces), 'utf-8');
  if (matchBytes > limits.maxMatchTraceBytes) {
    throw new ArtifactLimitExceededError(
      `Werewolf decision trace artifact is ${matchBytes} bytes; limit is ${limits.maxMatchTraceBytes}`,
    );
  }
}

function traceObjectKey(matchId: string): string {
  return `matches/${safePathSegment(matchId)}/decision-trace.jsonl`;
}

function cloneTrace(trace: WerewolfDecisionTrace): WerewolfDecisionTrace {
  return JSON.parse(JSON.stringify(toPublicWerewolfDecisionTrace(trace))) as WerewolfDecisionTrace;
}
