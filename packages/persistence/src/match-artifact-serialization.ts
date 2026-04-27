import { createHash } from 'crypto';
import path from 'path';
import type {
  HandSummary,
  MatchArtifactFileRef,
  MatchArtifactIndexEntry,
  MatchArtifactManifest,
  MatchArtifactRecord,
  MatchSummary,
  PublicHandSummary,
  ReplayEvent,
} from '@agent-poker/shared';
import type { SaveMatchArtifactInput } from './match-artifact-store.js';

export interface SerializedMatchArtifact {
  record: MatchArtifactRecord;
  summaryRaw: string;
  replayRaw: string;
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
  const summaryRaw = serializeJson(summary);
  const replayRaw = serializeReplayEvents(replayEvents);

  const manifest: MatchArtifactManifest = {
    artifactVersion: 1,
    matchId: input.matchId,
    tableId: input.tableId,
    createdAt,
    handIds: summary.handIds,
    files: {
      summary: fileRef('summary.json', summaryRaw, 'application/json'),
      replay: fileRef('replay.jsonl', replayRaw, 'application/x-ndjson'),
    },
  };

  const record = { manifest, summary, replayEvents };
  return {
    record,
    summaryRaw,
    replayRaw,
    manifestRaw: serializeJson(manifest),
  };
}

function toPublicHandSummary(hand: HandSummary): PublicHandSummary {
  return {
    ...hand,
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

function toPublicReplayEvents(events: ReplayEvent[]): ReplayEvent[] {
  return events
    .map(event => replayEventToPublicArtifact(event))
    .filter((event): event is ReplayEvent => event !== null);
}

function replayEventToPublicArtifact(event: ReplayEvent): ReplayEvent | null {
  if (event.eventType === 'hole_cards.dealt') return null;
  if (containsPrivateCards(event.data)) {
    return { ...event, data: stripPrivateCards(event.data) as Record<string, unknown> };
  }
  return event;
}

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
