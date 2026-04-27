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
import {
  buildArtifact,
  safePathSegment,
  toIndexEntry,
} from './match-artifact-serialization.js';

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
