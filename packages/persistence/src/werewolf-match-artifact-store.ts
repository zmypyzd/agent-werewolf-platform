import { ArtifactLimitExceededError } from '@agent-poker/shared';
import { safePathSegment } from './match-artifact-serialization.js';
import type { IObjectStore } from './object-store.js';
import {
  buildWerewolfArtifact,
  type BuildWerewolfArtifactInput,
  toWerewolfArtifactIndexEntry,
} from './werewolf-match-artifact-serialization.js';
import type {
  WerewolfMatchArtifactIndexEntry,
  WerewolfMatchArtifactManifest,
  WerewolfMatchArtifactRecord,
  WerewolfMatchPublicSummary,
} from './werewolf-match-artifact-types.js';
import { parseWerewolfDecisionTraces } from './werewolf-decision-trace-serialization.js';

export interface GetWerewolfMatchArtifactOptions {
  includeReplayEvents?: boolean;
  includeDecisionTraces?: boolean;
}

export interface IWerewolfMatchArtifactStore {
  saveMatchArtifact(input: BuildWerewolfArtifactInput): Promise<WerewolfMatchArtifactRecord>;
  getMatchArtifact(
    matchId: string,
    options?: GetWerewolfMatchArtifactOptions,
  ): Promise<WerewolfMatchArtifactRecord | null>;
  listMatchArtifacts(): Promise<WerewolfMatchArtifactIndexEntry[]>;
  deleteMatchArtifact?(matchId: string): Promise<void>;
}

export interface WerewolfMatchArtifactCostLimits {
  maxReplayBytes: number;
  maxSummaryBytes: number;
  maxDecisionTraceBytes: number;
  maxIndexEntries: number;
}

export const DEFAULT_WEREWOLF_MATCH_ARTIFACT_COST_LIMITS: WerewolfMatchArtifactCostLimits = {
  maxReplayBytes: 1024 * 1024,
  maxSummaryBytes: 256 * 1024,
  maxDecisionTraceBytes: 512 * 1024,
  maxIndexEntries: 100,
};

interface SequencedRecord {
  record: WerewolfMatchArtifactRecord;
  sequence: number;
}

export class MemoryWerewolfMatchArtifactStore implements IWerewolfMatchArtifactStore {
  private readonly records = new Map<string, SequencedRecord>();
  private nextSequence = 0;

  async saveMatchArtifact(
    input: BuildWerewolfArtifactInput,
  ): Promise<WerewolfMatchArtifactRecord> {
    const { record } = buildWerewolfArtifact(input);
    this.nextSequence += 1;
    this.records.set(record.manifest.matchId, { record, sequence: this.nextSequence });
    return record;
  }

  async getMatchArtifact(
    matchId: string,
    options: GetWerewolfMatchArtifactOptions = {},
  ): Promise<WerewolfMatchArtifactRecord | null> {
    safePathSegment(matchId);
    const found = this.records.get(matchId);
    if (!found) return null;
    let next: WerewolfMatchArtifactRecord = found.record;
    if (options.includeReplayEvents === false) {
      next = { ...next, replayEvents: [] };
    }
    if (options.includeDecisionTraces === false) {
      next = { ...next, decisionTraces: [] };
    }
    return next;
  }

  async listMatchArtifacts(): Promise<WerewolfMatchArtifactIndexEntry[]> {
    return [...this.records.values()]
      .sort((a, b) => {
        const delta = b.record.manifest.createdAt - a.record.manifest.createdAt;
        if (delta !== 0) return delta;
        return b.sequence - a.sequence;
      })
      .map(({ record }) => toWerewolfArtifactIndexEntry(record));
  }

  async deleteMatchArtifact(matchId: string): Promise<void> {
    safePathSegment(matchId);
    this.records.delete(matchId);
  }
}

export class ObjectWerewolfMatchArtifactStore implements IWerewolfMatchArtifactStore {
  private readonly limits: WerewolfMatchArtifactCostLimits;

  constructor(
    private readonly objectStore: IObjectStore,
    limits: Partial<WerewolfMatchArtifactCostLimits> = {},
  ) {
    this.limits = { ...DEFAULT_WEREWOLF_MATCH_ARTIFACT_COST_LIMITS, ...limits };
  }

  async saveMatchArtifact(
    input: BuildWerewolfArtifactInput,
  ): Promise<WerewolfMatchArtifactRecord> {
    const { record, summaryRaw, replayRaw, decisionTraceRaw, manifestRaw } =
      buildWerewolfArtifact(input);
    this.assertWithinLimits(summaryRaw, replayRaw, decisionTraceRaw);
    const prefix = `matches/${record.manifest.matchId}`;

    await this.objectStore.putText({
      key: `${prefix}/summary.json`,
      body: summaryRaw,
      contentType: 'application/json',
    });
    await this.objectStore.putText({
      key: `${prefix}/replay.jsonl`,
      body: replayRaw,
      contentType: 'application/x-ndjson',
    });
    await this.objectStore.putText({
      key: `${prefix}/decision-trace.jsonl`,
      body: decisionTraceRaw,
      contentType: 'application/x-ndjson',
    });
    await this.objectStore.putText({
      key: `${prefix}/manifest.json`,
      body: manifestRaw,
      contentType: 'application/json',
    });
    await this.upsertIndex(toWerewolfArtifactIndexEntry(record));
    return record;
  }

  async getMatchArtifact(
    matchId: string,
    options: GetWerewolfMatchArtifactOptions = {},
  ): Promise<WerewolfMatchArtifactRecord | null> {
    const safe = safePathSegment(matchId);
    const prefix = `matches/${safe}`;
    const manifestRaw = await this.objectStore.getText(`${prefix}/manifest.json`);
    const summaryRaw = await this.objectStore.getText(`${prefix}/summary.json`);
    if (!manifestRaw || !summaryRaw) return null;
    const manifest = JSON.parse(manifestRaw) as WerewolfMatchArtifactManifest;
    const summary = JSON.parse(summaryRaw) as WerewolfMatchPublicSummary;

    let replayEvents: WerewolfMatchArtifactRecord['replayEvents'] = [];
    if (options.includeReplayEvents !== false) {
      const replayRaw = await this.objectStore.getText(`${prefix}/replay.jsonl`);
      if (replayRaw === null) return null;
      replayEvents = replayRaw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as WerewolfMatchArtifactRecord['replayEvents'][number]);
    }

    let decisionTraces: WerewolfMatchArtifactRecord['decisionTraces'] = [];
    if (options.includeDecisionTraces !== false) {
      const traceRaw = await this.objectStore.getText(`${prefix}/decision-trace.jsonl`);
      if (traceRaw === null) return null;
      decisionTraces = parseWerewolfDecisionTraces(traceRaw);
    }

    return { manifest, summary, replayEvents, decisionTraces };
  }

  async listMatchArtifacts(): Promise<WerewolfMatchArtifactIndexEntry[]> {
    const raw = await this.objectStore.getText('matches/index.json');
    if (!raw) return [];
    const entries = JSON.parse(raw) as WerewolfMatchArtifactIndexEntry[];
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteMatchArtifact(matchId: string): Promise<void> {
    const safe = safePathSegment(matchId);
    const prefix = `matches/${safe}`;
    if (this.objectStore.delete) {
      await this.objectStore.delete(`${prefix}/summary.json`);
      await this.objectStore.delete(`${prefix}/replay.jsonl`);
      await this.objectStore.delete(`${prefix}/decision-trace.jsonl`);
      await this.objectStore.delete(`${prefix}/manifest.json`);
    }
    const entries = await this.listMatchArtifacts();
    const next = entries.filter((e) => e.matchId !== safe);
    await this.objectStore.putText({
      key: 'matches/index.json',
      body: `${JSON.stringify(next, null, 2)}\n`,
      contentType: 'application/json',
    });
  }

  private assertWithinLimits(summaryRaw: string, replayRaw: string, decisionTraceRaw: string): void {
    const sBytes = Buffer.byteLength(summaryRaw, 'utf-8');
    const rBytes = Buffer.byteLength(replayRaw, 'utf-8');
    const dBytes = Buffer.byteLength(decisionTraceRaw, 'utf-8');
    if (sBytes > this.limits.maxSummaryBytes) {
      throw new ArtifactLimitExceededError(
        `Werewolf summary is ${sBytes} bytes; limit is ${this.limits.maxSummaryBytes}`,
      );
    }
    if (rBytes > this.limits.maxReplayBytes) {
      throw new ArtifactLimitExceededError(
        `Werewolf replay is ${rBytes} bytes; limit is ${this.limits.maxReplayBytes}`,
      );
    }
    if (dBytes > this.limits.maxDecisionTraceBytes) {
      throw new ArtifactLimitExceededError(
        `Werewolf decision trace is ${dBytes} bytes; limit is ${this.limits.maxDecisionTraceBytes}`,
      );
    }
  }

  private async upsertIndex(entry: WerewolfMatchArtifactIndexEntry): Promise<void> {
    const entries = await this.listMatchArtifacts();
    const next = [
      entry,
      ...entries.filter((existing) => existing.matchId !== entry.matchId),
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
