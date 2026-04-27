import { createHash } from 'crypto';
import fs from 'fs';
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

export interface SaveMatchArtifactInput {
  matchId: string;
  tableId: string;
  name: string;
  seed: string;
  hands: HandSummary[];
  replayEvents: ReplayEvent[];
}

export interface GetMatchArtifactOptions {
  includeReplayEvents?: boolean;
}

export interface IMatchArtifactStore {
  saveMatchArtifact(input: SaveMatchArtifactInput): Promise<MatchArtifactRecord>;
  getMatchArtifact(matchId: string, options?: GetMatchArtifactOptions): Promise<MatchArtifactRecord | null>;
  listMatchArtifacts(): Promise<MatchArtifactIndexEntry[]>;
}

interface SerializedMatchArtifact {
  record: MatchArtifactRecord;
  summaryRaw: string;
  replayRaw: string;
  manifestRaw: string;
}

interface SequencedMatchArtifactRecord {
  record: MatchArtifactRecord;
  sequence: number;
}

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function safePathSegment(matchId: string): string {
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

function fileRef(filePath: string, raw: string, contentType: string): MatchArtifactFileRef {
  return {
    path: filePath,
    sha256: sha256(raw),
    bytes: Buffer.byteLength(raw, 'utf-8'),
    contentType,
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

function toPublicReplayEvents(events: ReplayEvent[]): ReplayEvent[] {
  return events
    .map(event => replayEventToPublicArtifact(event))
    .filter((event): event is ReplayEvent => event !== null);
}

function replayEventToPublicArtifact(event: ReplayEvent): ReplayEvent | null {
  if (event.eventType === 'hole_cards.dealt') return null;

  if (containsPrivateCards(event.data)) {
    return {
      ...event,
      data: stripPrivateCards(event.data) as Record<string, unknown>,
    };
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

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function serializeReplayEvents(replayEvents: ReplayEvent[]): string {
  return replayEvents.map(event => JSON.stringify(event)).join('\n') +
    (replayEvents.length > 0 ? '\n' : '');
}

function buildArtifact(input: SaveMatchArtifactInput, createdAt = Date.now()): SerializedMatchArtifact {
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

function toIndexEntry(record: MatchArtifactRecord): MatchArtifactIndexEntry {
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

export class MemoryMatchArtifactStore implements IMatchArtifactStore {
  private records = new Map<string, SequencedMatchArtifactRecord>();
  private nextSequence = 0;

  async saveMatchArtifact(input: SaveMatchArtifactInput): Promise<MatchArtifactRecord> {
    const { record } = buildArtifact(input);
    this.nextSequence += 1;
    this.records.set(record.manifest.matchId, {
      record,
      sequence: this.nextSequence,
    });
    return record;
  }

  async getMatchArtifact(
    matchId: string,
    options: GetMatchArtifactOptions = {},
  ): Promise<MatchArtifactRecord | null> {
    const record = this.records.get(matchId)?.record;
    if (!record) return null;
    if (options.includeReplayEvents === false) {
      return { ...record, replayEvents: [] };
    }
    return record;
  }

  async listMatchArtifacts(): Promise<MatchArtifactIndexEntry[]> {
    return [...this.records.values()]
      .sort((a, b) => {
        const createdAtDelta = b.record.manifest.createdAt - a.record.manifest.createdAt;
        if (createdAtDelta !== 0) return createdAtDelta;
        return b.sequence - a.sequence;
      })
      .map(({ record }) => toIndexEntry(record));
  }
}

export class FileMatchArtifactStore implements IMatchArtifactStore {
  constructor(private readonly baseDir: string) {}

  private rootDir(): string {
    return path.join(this.baseDir, 'matches');
  }

  private matchDir(matchId: string): string {
    return path.join(this.rootDir(), safePathSegment(matchId));
  }

  private indexFile(): string {
    return path.join(this.rootDir(), 'index.json');
  }

  private ensureMatchDir(matchId: string): void {
    fs.mkdirSync(this.matchDir(matchId), { recursive: true });
  }

  async saveMatchArtifact(input: SaveMatchArtifactInput): Promise<MatchArtifactRecord> {
    safePathSegment(input.matchId);
    const { record, summaryRaw, replayRaw, manifestRaw } = buildArtifact(input);
    this.ensureMatchDir(record.manifest.matchId);

    const dir = this.matchDir(record.manifest.matchId);
    fs.writeFileSync(path.join(dir, 'summary.json'), summaryRaw, 'utf-8');
    fs.writeFileSync(path.join(dir, 'replay.jsonl'), replayRaw, 'utf-8');
    fs.writeFileSync(path.join(dir, 'manifest.json'), manifestRaw, 'utf-8');

    await this.upsertIndex(toIndexEntry(record));
    return record;
  }

  async getMatchArtifact(
    matchId: string,
    options: GetMatchArtifactOptions = {},
  ): Promise<MatchArtifactRecord | null> {
    const dir = this.matchDir(safePathSegment(matchId));
    const manifestFile = path.join(dir, 'manifest.json');
    const summaryFile = path.join(dir, 'summary.json');
    const replayFile = path.join(dir, 'replay.jsonl');
    if (!fs.existsSync(manifestFile) || !fs.existsSync(summaryFile)) {
      return null;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as MatchArtifactManifest;
    const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8')) as MatchSummary;
    if (options.includeReplayEvents === false) {
      return { manifest, summary, replayEvents: [] };
    }
    if (!fs.existsSync(replayFile)) {
      return null;
    }
    const rawReplay = fs.readFileSync(replayFile, 'utf-8');
    const replayEvents = rawReplay
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as ReplayEvent);

    return { manifest, summary, replayEvents };
  }

  async listMatchArtifacts(): Promise<MatchArtifactIndexEntry[]> {
    if (!fs.existsSync(this.indexFile())) return [];
    const raw = fs.readFileSync(this.indexFile(), 'utf-8');
    const entries = JSON.parse(raw) as MatchArtifactIndexEntry[];
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }

  private async upsertIndex(entry: MatchArtifactIndexEntry): Promise<void> {
    fs.mkdirSync(this.rootDir(), { recursive: true });
    const entries = await this.listMatchArtifacts();
    const next = [
      entry,
      ...entries.filter(existing => existing.matchId !== entry.matchId),
    ].sort((a, b) => b.createdAt - a.createdAt);
    fs.writeFileSync(this.indexFile(), `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  }
}
