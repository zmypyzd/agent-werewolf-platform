import { createHash } from 'crypto';
import path from 'path';
import type {
  DecisionTrace,
  HandSummary,
  MatchArtifactFileRef,
  MatchArtifactIndexEntry,
  MatchArtifactManifest,
  MatchArtifactRecord,
  MatchSummary,
  PokerReplayEventType,
  PublicHandSummary,
  ReplayEvent,
} from '@agent-poker/shared';
import { serializeDecisionTraces, toPublicDecisionTrace } from './decision-trace-serialization.js';
import { buildAnalysisSummary, serializeAnalysisSummary } from './match-analysis-summary.js';
import type { SaveMatchArtifactInput } from './match-artifact-store.js';

export interface SerializedMatchArtifact {
  record: MatchArtifactRecord;
  summaryRaw: string;
  replayRaw: string;
  decisionTraceRaw: string;
  analysisSummaryRaw: string;
  manifestRaw: string;
}

export function safePathSegment(matchId: string): string {
  if (
    matchId === '' ||
    matchId === '.' ||
    matchId === '..' ||
    path.isAbsolute(matchId) ||
    path.win32.isAbsolute(matchId) ||
    matchId.includes('/') ||
    matchId.includes('\\')
  ) {
    throw new Error(`Invalid matchId path segment: ${matchId}`);
  }
  return matchId;
}

export function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function serializeReplayEvents(replayEvents: ReplayEvent[]): string {
  return replayEvents.map(event => JSON.stringify(event)).join('\n') +
    (replayEvents.length > 0 ? '\n' : '');
}

export function fileRef(filePath: string, raw: string, contentType: string): MatchArtifactFileRef {
  return {
    path: filePath,
    sha256: sha256(raw),
    bytes: Buffer.byteLength(raw, 'utf-8'),
    contentType,
  };
}

export function toIndexEntry(record: MatchArtifactRecord): MatchArtifactIndexEntry {
  return {
    matchId: record.manifest.matchId,
    tableId: record.manifest.tableId,
    name: record.summary.name,
    seed: record.summary.seed,
    handCount: record.summary.handIds.length,
    agentIds: record.summary.agentIds,
    startedAt: record.summary.startedAt,
    completedAt: record.summary.completedAt,
    createdAt: record.manifest.createdAt,
    artifactPath: `matches/${record.manifest.matchId}/manifest.json`,
  };
}

export function buildArtifact(input: SaveMatchArtifactInput, createdAt = Date.now()): SerializedMatchArtifact {
  const summary = buildSummary(input);
  const replayEvents = toPublicReplayEvents(sortReplayEvents(summary, input.replayEvents));
  const decisionTraces = toPublicDecisionTraces(sortDecisionTraces(summary, input.decisionTraces ?? []));
  const analysisSummary = buildAnalysisSummary(summary, decisionTraces, createdAt);
  const summaryRaw = serializeJson(summary);
  const replayRaw = serializeReplayEvents(replayEvents);
  const decisionTraceRaw = serializeDecisionTraces(decisionTraces);
  const analysisSummaryRaw = serializeAnalysisSummary(analysisSummary);

  const manifest: MatchArtifactManifest = {
    artifactVersion: 1,
    matchId: input.matchId,
    tableId: input.tableId,
    createdAt,
    handIds: summary.handIds,
    files: {
      summary: fileRef('summary.json', summaryRaw, 'application/json'),
      replay: fileRef('replay.jsonl', replayRaw, 'application/x-ndjson'),
      decisionTrace: fileRef('decision-trace.jsonl', decisionTraceRaw, 'application/x-ndjson'),
      analysisSummary: fileRef('analysis-summary.json', analysisSummaryRaw, 'application/json'),
    },
  };

  const record = { manifest, summary, replayEvents, decisionTraces, analysisSummary };
  return {
    record,
    summaryRaw,
    replayRaw,
    decisionTraceRaw,
    analysisSummaryRaw,
    manifestRaw: serializeJson(manifest),
  };
}

function toPublicHandSummary(hand: HandSummary): PublicHandSummary {
  return {
    handId: hand.handId,
    tableId: hand.tableId,
    handNumber: hand.handNumber,
    startedAt: hand.startedAt,
    completedAt: hand.completedAt,
    blindConfig: hand.blindConfig,
    communityCards: hand.communityCards,
    allActions: hand.allActions,
    results: hand.results,
    finalPots: hand.finalPots,
    players: hand.players.map(player => {
      const { holeCards: _holeCards, handEvaluation: _handEvaluation, ...publicPlayer } = player;
      return publicPlayer;
    }),
  };
}

function buildSummary(input: SaveMatchArtifactInput): MatchSummary {
  const hands = [...input.hands].sort((a, b) => a.handNumber - b.handNumber);
  const first = hands[0];
  const last = hands[hands.length - 1];
  const finalStacks: Record<string, number> = {};
  for (const player of last?.players || []) {
    finalStacks[player.agentId] = player.stackAfter;
  }
  const agentIds = Array.from(
    new Set(hands.flatMap(hand => hand.players.map(player => player.agentId))),
  ).sort();

  return {
    matchId: input.matchId,
    tableId: input.tableId,
    name: input.name,
    seed: input.seed,
    startedAt: first ? first.startedAt : Date.now(),
    completedAt: last ? last.completedAt : Date.now(),
    handIds: hands.map(hand => hand.handId),
    hands: hands.map(toPublicHandSummary),
    finalStacks,
    agentIds,
  };
}

function sortReplayEvents(summary: MatchSummary, events: ReplayEvent[]): ReplayEvent[] {
  const handOrder = new Map(summary.handIds.map((handId, index) => [handId, index]));
  return [...events].sort((a, b) => {
    const aOrder = handOrder.get(a.handId);
    const bOrder = handOrder.get(b.handId);
    const handDelta = (aOrder !== undefined ? aOrder : Number.MAX_SAFE_INTEGER) -
      (bOrder !== undefined ? bOrder : Number.MAX_SAFE_INTEGER);
    if (handDelta !== 0) return handDelta;
    return a.sequence - b.sequence;
  });
}

function sortDecisionTraces(summary: MatchSummary, traces: DecisionTrace[]): DecisionTrace[] {
  const handOrder = new Map(summary.handIds.map((handId, index) => [handId, index]));
  return [...traces].sort((a, b) => {
    const aOrder = handOrder.get(a.handId);
    const bOrder = handOrder.get(b.handId);
    const handDelta = (aOrder !== undefined ? aOrder : Number.MAX_SAFE_INTEGER) -
      (bOrder !== undefined ? bOrder : Number.MAX_SAFE_INTEGER);
    if (handDelta !== 0) return handDelta;
    return a.createdAt - b.createdAt;
  });
}

function toPublicReplayEvents(events: ReplayEvent[]): ReplayEvent[] {
  return events
    .map(event => replayEventToPublicArtifact(event))
    .filter((event): event is ReplayEvent => event !== null);
}

function toPublicDecisionTraces(traces: DecisionTrace[]): DecisionTrace[] {
  return traces.map(toPublicDecisionTrace);
}

// Persistence-side parallel of `replayEventToPublic` in
// packages/realtime/src/filter.ts. Same exhaustiveness contract:
// adding a new `PokerReplayEventType` variant fails compile here
// (the default arm asserts `never`) AND in the realtime filter, so
// both broadcast and artifact paths get the new variant classified
// before it can carry private state through unredacted. Without this,
// the realtime filter's compile guard catches new event types but
// the artifact-write path silently passes them through with only a
// holeCards strip — exactly the bug the realtime fix was written to
// prevent, one layer down.
function replayEventToPublicArtifact(event: ReplayEvent): ReplayEvent | null {
  switch (event.eventType) {
    // Never broadcast — private to one seat. hole_cards.dealt is
    // dropped from the artifact entirely.
    case 'hole_cards.dealt':
      return null;

    // Public events (incl. showdown.started, which embeds per-player
    // holeCards in the internal form). Defense-in-depth: every
    // payload is deep-stripped for any `holeCards` field at any
    // nesting depth before persistence. Returns the original
    // reference when nothing matches for cheap pass-through.
    case 'hand.started':
    case 'hand.completed':
    case 'blinds.posted':
    case 'community_cards.dealt':
    case 'betting_round.started':
    case 'betting_round.complete':
    case 'action.requested':
    case 'action.received':
    case 'action.applied':
    case 'agent.timeout':
    case 'agent.invalid_action':
    case 'pot.awarded':
    case 'showdown.started':
    case 'showdown.result':
      return scrubIfPrivateCards(event);

    default: {
      // Exhaustiveness guard — adding a new PokerReplayEventType
      // variant in @agent-poker/shared forces this default arm to
      // fail compilation until the new variant gets an explicit
      // case above.
      const _exhaustive: never = event.eventType;
      void _exhaustive;
      // Runtime fail-closed: an unknown event type at runtime gets
      // deep-stripped for holeCards. The compile guard is the real
      // protection — this is the belt-and-braces fallback for a
      // stale build that shipped against a newer shared release.
      return scrubIfPrivateCards(event);
    }
  }
}

function scrubIfPrivateCards(event: ReplayEvent): ReplayEvent {
  if (containsPrivateCards(event.data)) {
    return { ...event, data: stripPrivateCards(event.data) as Record<string, unknown> };
  }
  return event;
}

// Re-exported so callers that want to iterate the exhaustive event
// classification (e.g., a future audit script) can do so without
// reaching into @agent-poker/shared directly.
export type { PokerReplayEventType };

function containsPrivateCards(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsPrivateCards);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'holeCards') return true;
    if (containsPrivateCards(child)) return true;
  }
  return false;
}

function stripPrivateCards(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripPrivateCards);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'holeCards') continue;
    output[key] = stripPrivateCards(child);
  }
  return output;
}
