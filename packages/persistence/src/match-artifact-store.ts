import fs from 'fs';
import path from 'path';
import type {
  HandSummary,
  MatchArtifactIndexEntry,
  MatchArtifactManifest,
  MatchArtifactRecord,
  MatchSummary,
  ReplayEvent,
} from '@agent-poker/shared';
import { ArtifactLimitExceededError } from '@agent-poker/shared';
import {
  buildArtifact,
  safePathSegment,
  toIndexEntry,
} from './match-artifact-serialization.js';
import type { IObjectStore } from './object-store.js';

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

interface SequencedMatchArtifactRecord {
  record: MatchArtifactRecord;
  sequence: number;
}

export interface MatchArtifactCostLimits {
  maxReplayBytes: number;
  maxSummaryBytes: number;
  maxIndexEntries: number;
}

const DEFAULT_MATCH_ARTIFACT_COST_LIMITS: MatchArtifactCostLimits = {
  maxReplayBytes: 1024 * 1024,
  maxSummaryBytes: 256 * 1024,
  maxIndexEntries: 100,
};

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

export class ObjectMatchArtifactStore implements IMatchArtifactStore {
  private readonly limits: MatchArtifactCostLimits;

  constructor(
    private readonly objectStore: IObjectStore,
    limits: Partial<MatchArtifactCostLimits> = {},
  ) {
    this.limits = { ...DEFAULT_MATCH_ARTIFACT_COST_LIMITS, ...limits };
  }

  async saveMatchArtifact(input: SaveMatchArtifactInput): Promise<MatchArtifactRecord> {
    safePathSegment(input.matchId);
    const { record, summaryRaw, replayRaw, manifestRaw } = buildArtifact(input);
    this.assertWithinLimits(summaryRaw, replayRaw);
    const matchPrefix = `matches/${record.manifest.matchId}`;

    await this.objectStore.putText({
      key: `${matchPrefix}/summary.json`,
      body: summaryRaw,
      contentType: 'application/json',
    });
    await this.objectStore.putText({
      key: `${matchPrefix}/replay.jsonl`,
      body: replayRaw,
      contentType: 'application/x-ndjson',
    });
    await this.objectStore.putText({
      key: `${matchPrefix}/manifest.json`,
      body: manifestRaw,
      contentType: 'application/json',
    });
    await this.upsertIndex(toIndexEntry(record));
    return record;
  }

  async getMatchArtifact(
    matchId: string,
    options: GetMatchArtifactOptions = {},
  ): Promise<MatchArtifactRecord | null> {
    const safeMatchId = safePathSegment(matchId);
    const matchPrefix = `matches/${safeMatchId}`;
    const manifestRaw = await this.objectStore.getText(`${matchPrefix}/manifest.json`);
    const summaryRaw = await this.objectStore.getText(`${matchPrefix}/summary.json`);
    if (!manifestRaw || !summaryRaw) return null;

    const manifest = JSON.parse(manifestRaw) as MatchArtifactManifest;
    const summary = JSON.parse(summaryRaw) as MatchSummary;
    if (options.includeReplayEvents === false) {
      return { manifest, summary, replayEvents: [] };
    }

    const replayRaw = await this.objectStore.getText(`${matchPrefix}/replay.jsonl`);
    if (!replayRaw) return null;
    const replayEvents = replayRaw
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as ReplayEvent);

    return { manifest, summary, replayEvents };
  }

  async listMatchArtifacts(): Promise<MatchArtifactIndexEntry[]> {
    const raw = await this.objectStore.getText('matches/index.json');
    if (!raw) return [];
    const entries = JSON.parse(raw) as MatchArtifactIndexEntry[];
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }

  private assertWithinLimits(summaryRaw: string, replayRaw: string): void {
    const summaryBytes = Buffer.byteLength(summaryRaw, 'utf-8');
    const replayBytes = Buffer.byteLength(replayRaw, 'utf-8');
    if (summaryBytes > this.limits.maxSummaryBytes) {
      throw new ArtifactLimitExceededError(
        `Match summary is ${summaryBytes} bytes; limit is ${this.limits.maxSummaryBytes}`,
      );
    }
    if (replayBytes > this.limits.maxReplayBytes) {
      throw new ArtifactLimitExceededError(
        `Match replay is ${replayBytes} bytes; limit is ${this.limits.maxReplayBytes}`,
      );
    }
  }

  private async upsertIndex(entry: MatchArtifactIndexEntry): Promise<void> {
    const entries = await this.listMatchArtifacts();
    const next = [
      entry,
      ...entries.filter(existing => existing.matchId !== entry.matchId),
    ]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, this.limits.maxIndexEntries);

    await this.objectStore.putText({
      key: 'matches/index.json',
      body: `${JSON.stringify(next, null, 2)}\n`,
      contentType: 'application/json',
    });
  }
}
