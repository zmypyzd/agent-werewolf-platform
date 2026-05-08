import {
  ArtifactLimitExceededError,
  type WerewolfReplayEvent,
  type WerewolfSide,
} from '@agent-poker/shared';
import { safePathSegment } from '../match-artifact-serialization.js';
import {
  buildWerewolfArtifact,
  toWerewolfArtifactIndexEntry,
  type BuildWerewolfArtifactInput,
} from '../werewolf-match-artifact-serialization.js';
import {
  DEFAULT_WEREWOLF_MATCH_ARTIFACT_COST_LIMITS,
  type GetWerewolfMatchArtifactOptions,
  type IWerewolfMatchArtifactStore,
  type WerewolfMatchArtifactCostLimits,
} from '../werewolf-match-artifact-store.js';
import type {
  WerewolfMatchArtifactIndexEntry,
  WerewolfMatchArtifactManifest,
  WerewolfMatchArtifactRecord,
  WerewolfMatchPublicSummary,
} from '../werewolf-match-artifact-types.js';
import type { MatchPkResolver } from './postgres-werewolf-decision-trace-store.js';
import {
  PostgresWerewolfDecisionTraceStore,
} from './postgres-werewolf-decision-trace-store.js';
import { PostgresWerewolfReplayEventStore } from './postgres-werewolf-replay-event-store.js';
import type { SupabaseServiceClient } from './supabase-clients.js';

export interface PostgresWerewolfMatchArtifactStoreOptions {
  resolver: MatchPkResolver;
  limits?: Partial<WerewolfMatchArtifactCostLimits>;
}

interface SummaryRow {
  match_id: string;
  summary: WerewolfMatchPublicSummary;
  created_at: string;
}

interface MatchPublicRow {
  id: string;
  game_id: string;
  status: 'completed' | 'aborted';
  winner: WerewolfSide | null;
  started_at: string;
  completed_at: string | null;
}

// Postgres-backed artifact store. Replaces ObjectWerewolfMatchArtifactStore
// for the serverless deployment. Reads/writes split across three tables:
//
//   werewolf_match_summaries   (1 row per match — the bundled public summary)
//   werewolf_replay_events     (N rows — append-only public event log)
//   werewolf_decision_traces   (M rows — sanitized per-decision audit)
//
// Reads assemble a full WerewolfMatchArtifactRecord by joining the three.
// Writes from saveMatchArtifact() are idempotent — if the orchestrator
// already streamed events live, saveMatchArtifact() only ensures the summary
// row exists and back-fills any gaps.
export class PostgresWerewolfMatchArtifactStore implements IWerewolfMatchArtifactStore {
  private readonly limits: WerewolfMatchArtifactCostLimits;
  private readonly replayStore: PostgresWerewolfReplayEventStore;
  private readonly traceStore: PostgresWerewolfDecisionTraceStore;

  constructor(
    private readonly client: SupabaseServiceClient,
    private readonly options: PostgresWerewolfMatchArtifactStoreOptions,
  ) {
    this.limits = {
      ...DEFAULT_WEREWOLF_MATCH_ARTIFACT_COST_LIMITS,
      ...(options.limits ?? {}),
    };
    this.replayStore = new PostgresWerewolfReplayEventStore(client);
    this.traceStore = new PostgresWerewolfDecisionTraceStore(client, { resolver: options.resolver });
  }

  async saveMatchArtifact(
    input: BuildWerewolfArtifactInput,
  ): Promise<WerewolfMatchArtifactRecord> {
    const { record, summaryRaw, replayRaw, decisionTraceRaw } = buildWerewolfArtifact(input);
    this.assertWithinLimits(summaryRaw, replayRaw, decisionTraceRaw);

    const matchPk = await this.options.resolver.resolveMatchPk(record.summary.matchId);

    // Match metadata is the source of truth for "this match completed". The
    // summary row caches the assembled JSON so the public read path is a
    // single SELECT.
    const matchUpdate = {
      status: 'completed' as const,
      winner: record.summary.winner,
      night_count: record.summary.nightCount,
      day_count: record.summary.dayCount,
      step_count: record.summary.stepCount,
      replay_event_count: record.summary.replayEventCount,
      completed_at: new Date(record.summary.completedAt).toISOString(),
    };
    const { error: matchErr } = await this.client
      .from('werewolf_matches')
      .update(matchUpdate)
      .eq('id', matchPk);
    if (matchErr) {
      throw new Error(`saveMatchArtifact: update werewolf_matches failed: ${matchErr.message}`);
    }

    const seatRows = record.summary.finalPlayers.map((p) => ({
      match_id: matchPk,
      seat_index: p.seatIndex,
      role: p.role,
      side: p.side,
      alive: p.alive,
    }));
    if (seatRows.length > 0) {
      const { error: seatErr } = await this.client
        .from('werewolf_seats')
        .upsert(seatRows, { onConflict: 'match_id,seat_index' });
      if (seatErr) {
        throw new Error(`saveMatchArtifact: upsert werewolf_seats failed: ${seatErr.message}`);
      }
    }

    await this.replayStore.appendEvents(matchPk, record.replayEvents);

    for (const trace of record.decisionTraces) {
      await this.traceStore.appendDecisionTrace(trace);
    }

    const { error: summaryErr } = await this.client
      .from('werewolf_match_summaries')
      .upsert(
        {
          match_id: matchPk,
          summary: record.summary,
          created_at: new Date(record.manifest.createdAt).toISOString(),
        },
        { onConflict: 'match_id' },
      );
    if (summaryErr) {
      throw new Error(`saveMatchArtifact: upsert werewolf_match_summaries failed: ${summaryErr.message}`);
    }

    return record;
  }

  async getMatchArtifact(
    matchId: string,
    options: GetWerewolfMatchArtifactOptions = {},
  ): Promise<WerewolfMatchArtifactRecord | null> {
    const safe = safePathSegment(matchId);
    const matchPk = await this.options.resolver.resolveMatchPk(safe).catch(() => null);
    if (matchPk === null) return null;

    const { data: summaryData, error: summaryErr } = await this.client
      .from('werewolf_match_summaries')
      .select('match_id, summary, created_at')
      .eq('match_id', matchPk)
      .maybeSingle();
    if (summaryErr) throw new Error(`getMatchArtifact: ${summaryErr.message}`);
    if (!summaryData) return null;
    const summaryRow = summaryData as unknown as SummaryRow;

    const replayEvents: ReadonlyArray<WerewolfReplayEvent> =
      options.includeReplayEvents === false
        ? []
        : await this.replayStore.listEvents(matchPk);

    const decisionTraces =
      options.includeDecisionTraces === false
        ? []
        : await this.traceStore.listDecisionTraces(safe);

    const summary = summaryRow.summary;
    const manifest: WerewolfMatchArtifactManifest = {
      artifactVersion: 1,
      matchId: summary.matchId,
      createdAt: new Date(summaryRow.created_at).getTime(),
      // File refs are kept for API-shape parity. They point at the implicit
      // REST endpoints rather than blob paths — Phase 1's match route
      // serves these via SQL queries, not file reads.
      files: {
        summary: { path: 'summary.json', sha256: '', bytes: 0, contentType: 'application/json' },
        replay: { path: 'replay.jsonl', sha256: '', bytes: 0, contentType: 'application/x-ndjson' },
        decisionTrace: {
          path: 'decision-trace.jsonl',
          sha256: '',
          bytes: 0,
          contentType: 'application/x-ndjson',
        },
      },
    };

    return { manifest, summary, replayEvents, decisionTraces };
  }

  async listMatchArtifacts(): Promise<WerewolfMatchArtifactIndexEntry[]> {
    // Join match metadata with the cached summary; only matches that have
    // been finalized (summary row present) are returned. Limit matches the
    // existing memory-store default cap.
    const { data, error } = await this.client
      .from('werewolf_matches_public')
      .select('id, game_id, status, winner, started_at, completed_at')
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(this.limits.maxIndexEntries);
    if (error) throw new Error(`listMatchArtifacts: ${error.message}`);

    const rows = (data ?? []) as MatchPublicRow[];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const { data: summaryRows, error: sumErr } = await this.client
      .from('werewolf_match_summaries')
      .select('match_id, created_at')
      .in('match_id', ids);
    if (sumErr) throw new Error(`listMatchArtifacts: summaries: ${sumErr.message}`);

    const summaryByMatch = new Map<string, number>();
    for (const row of (summaryRows ?? []) as Array<{ match_id: string; created_at: string }>) {
      summaryByMatch.set(row.match_id, new Date(row.created_at).getTime());
    }

    const entries: WerewolfMatchArtifactIndexEntry[] = [];
    for (const r of rows) {
      const createdAt = summaryByMatch.get(r.id);
      if (createdAt === undefined || r.winner === null || r.completed_at === null) continue;
      entries.push(
        toWerewolfArtifactIndexEntry({
          manifest: {
            artifactVersion: 1,
            matchId: r.game_id,
            createdAt,
            files: {
              summary: { path: 'summary.json', sha256: '', bytes: 0, contentType: 'application/json' },
              replay: { path: 'replay.jsonl', sha256: '', bytes: 0, contentType: 'application/x-ndjson' },
              decisionTrace: {
                path: 'decision-trace.jsonl',
                sha256: '',
                bytes: 0,
                contentType: 'application/x-ndjson',
              },
            },
          },
          summary: {
            matchId: r.game_id,
            winner: r.winner,
            startedAt: new Date(r.started_at).getTime(),
            completedAt: new Date(r.completed_at).getTime(),
            durationMs: new Date(r.completed_at).getTime() - new Date(r.started_at).getTime(),
            nightCount: 0,
            dayCount: 0,
            stepCount: 0,
            replayEventCount: 0,
            finalPlayers: [],
            history: [],
          },
          replayEvents: [],
          decisionTraces: [],
        }),
      );
    }
    return entries;
  }

  async deleteMatchArtifact(matchId: string): Promise<void> {
    const matchPk = await this.options.resolver.resolveMatchPk(matchId).catch(() => null);
    if (matchPk === null) return;
    // ON DELETE CASCADE on werewolf_match_summaries → no separate cleanup
    // needed for that row. Replay events + traces also cascade off the
    // match. We delete the match row; the cascades handle the rest.
    const { error } = await this.client
      .from('werewolf_matches')
      .delete()
      .eq('id', matchPk);
    if (error) throw new Error(`deleteMatchArtifact: ${error.message}`);
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
}
