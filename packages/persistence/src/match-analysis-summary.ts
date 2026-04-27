import type {
  ActionType,
  AgentAnalysisSummary,
  AnalysisMetricSummary,
  DecisionTrace,
  DecisionTracePhase,
  MatchAnalysisSummary,
  MatchSummary,
  ReasoningIntent,
  ReasoningRiskLevel,
} from '@agent-poker/shared';

interface MetricAccumulator {
  decisionCount: number;
  actionCounts: Partial<Record<ActionType, number>>;
  streetCounts: Partial<Record<DecisionTracePhase, Partial<Record<ActionType, number>>>>;
  intentCounts: Partial<Record<ReasoningIntent, number>>;
  riskCounts: Partial<Record<ReasoningRiskLevel, number>>;
  missingReasoningCount: number;
  timeoutCount: number;
  invalidActionCount: number;
  fallbackCount: number;
  confidenceTotal: number;
  confidenceCount: number;
  latencyTotal: number;
  maxLatencyMs: number | null;
}

interface AgentAccumulator extends MetricAccumulator {
  agentId: string;
  playerIds: Set<string>;
  handIds: Set<string>;
}

export function buildAnalysisSummary(
  summary: MatchSummary,
  decisionTraces: DecisionTrace[],
  generatedAt = Date.now(),
): MatchAnalysisSummary {
  const totals = createMetricAccumulator();
  const agents = new Map<string, AgentAccumulator>();
  for (const agentId of summary.agentIds) {
    agents.set(agentId, createAgentAccumulator(agentId));
  }

  for (const trace of decisionTraces) {
    const agent = getAgentAccumulator(agents, trace.agentId);
    agent.playerIds.add(trace.playerId);
    agent.handIds.add(trace.handId);
    applyTrace(totals, trace);
    applyTrace(agent, trace);
  }

  const handOrder = new Map(summary.handIds.map((handId, index) => [handId, index]));
  return {
    matchId: summary.matchId,
    tableId: summary.tableId,
    generatedAt,
    handCount: summary.handIds.length,
    agentCount: agents.size,
    decisionCount: totals.decisionCount,
    totals: finalizeMetricSummary(totals),
    agents: [...agents.values()]
      .sort((a, b) => a.agentId.localeCompare(b.agentId))
      .map(agent => finalizeAgentSummary(agent, handOrder)),
  };
}

export function serializeAnalysisSummary(summary: MatchAnalysisSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

export function parseAnalysisSummary(raw: string): MatchAnalysisSummary {
  return JSON.parse(raw) as MatchAnalysisSummary;
}

function createMetricAccumulator(): MetricAccumulator {
  return {
    decisionCount: 0,
    actionCounts: {},
    streetCounts: {},
    intentCounts: {},
    riskCounts: {},
    missingReasoningCount: 0,
    timeoutCount: 0,
    invalidActionCount: 0,
    fallbackCount: 0,
    confidenceTotal: 0,
    confidenceCount: 0,
    latencyTotal: 0,
    maxLatencyMs: null,
  };
}

function createAgentAccumulator(agentId: string): AgentAccumulator {
  return {
    ...createMetricAccumulator(),
    agentId,
    playerIds: new Set<string>(),
    handIds: new Set<string>(),
  };
}

function getAgentAccumulator(agents: Map<string, AgentAccumulator>, agentId: string): AgentAccumulator {
  const existing = agents.get(agentId);
  if (existing) return existing;
  const next = createAgentAccumulator(agentId);
  agents.set(agentId, next);
  return next;
}

function applyTrace(accumulator: MetricAccumulator, trace: DecisionTrace): void {
  accumulator.decisionCount += 1;
  increment(accumulator.actionCounts, trace.appliedAction.actionType);
  incrementStreetAction(accumulator.streetCounts, trace.phase, trace.appliedAction.actionType);
  accumulator.latencyTotal += trace.latencyMs;
  accumulator.maxLatencyMs = accumulator.maxLatencyMs === null
    ? trace.latencyMs
    : Math.max(accumulator.maxLatencyMs, trace.latencyMs);

  if (trace.timedOut) accumulator.timeoutCount += 1;
  if (trace.invalidReason !== null || trace.appliedAction.fallbackReason === 'invalid_action') {
    accumulator.invalidActionCount += 1;
  }
  if (trace.appliedAction.fallbackReason !== undefined) {
    accumulator.fallbackCount += 1;
  }

  if (!trace.reasoningSummary) {
    accumulator.missingReasoningCount += 1;
    return;
  }

  increment(accumulator.intentCounts, trace.reasoningSummary.intent);
  increment(accumulator.riskCounts, trace.reasoningSummary.riskLevel);
  accumulator.confidenceTotal += trace.reasoningSummary.confidence;
  accumulator.confidenceCount += 1;
}

function finalizeMetricSummary(accumulator: MetricAccumulator): AnalysisMetricSummary {
  return {
    decisionCount: accumulator.decisionCount,
    actionCounts: sortCountMap(accumulator.actionCounts),
    streetCounts: sortStreetCounts(accumulator.streetCounts),
    intentCounts: sortCountMap(accumulator.intentCounts),
    riskCounts: sortCountMap(accumulator.riskCounts),
    missingReasoningCount: accumulator.missingReasoningCount,
    timeoutCount: accumulator.timeoutCount,
    invalidActionCount: accumulator.invalidActionCount,
    fallbackCount: accumulator.fallbackCount,
    averageConfidence: accumulator.confidenceCount > 0
      ? round(accumulator.confidenceTotal / accumulator.confidenceCount, 4)
      : null,
    averageLatencyMs: accumulator.decisionCount > 0
      ? round(accumulator.latencyTotal / accumulator.decisionCount, 2)
      : null,
    maxLatencyMs: accumulator.maxLatencyMs,
  };
}

function finalizeAgentSummary(
  accumulator: AgentAccumulator,
  handOrder: Map<string, number>,
): AgentAnalysisSummary {
  return {
    agentId: accumulator.agentId,
    playerIds: [...accumulator.playerIds].sort(),
    handIds: [...accumulator.handIds].sort((a, b) => {
      const aOrder = handOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = handOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b);
    }),
    ...finalizeMetricSummary(accumulator),
  };
}

function increment<T extends string>(counts: Partial<Record<T, number>>, key: T): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function incrementStreetAction(
  streetCounts: Partial<Record<DecisionTracePhase, Partial<Record<ActionType, number>>>>,
  phase: DecisionTracePhase,
  actionType: ActionType,
): void {
  streetCounts[phase] ??= {};
  increment(streetCounts[phase], actionType);
}

function sortCountMap<T extends string>(counts: Partial<Record<T, number>>): Partial<Record<T, number>> {
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  ) as Partial<Record<T, number>>;
}

function sortStreetCounts(
  streetCounts: Partial<Record<DecisionTracePhase, Partial<Record<ActionType, number>>>>,
): Partial<Record<DecisionTracePhase, Partial<Record<ActionType, number>>>> {
  return Object.fromEntries(
    Object.entries(streetCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([phase, counts]) => [phase, sortCountMap(counts)]),
  ) as Partial<Record<DecisionTracePhase, Partial<Record<ActionType, number>>>>;
}

function round(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}
