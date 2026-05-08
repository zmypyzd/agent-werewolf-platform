import {
  ArtifactLimitExceededError,
  type WerewolfDecisionTrace,
  type WerewolfDecisionTraceFallbackReason,
  type WerewolfPhase,
} from '@agent-poker/shared';
import { toPublicWerewolfDecisionTrace } from '../werewolf-decision-trace-serialization.js';
import {
  DEFAULT_WEREWOLF_DECISION_TRACE_STORE_LIMITS,
  type IWerewolfDecisionTraceStore,
  type WerewolfDecisionTraceStoreLimits,
} from '../werewolf-decision-trace-store.js';
import type { SupabaseServiceClient } from './supabase-clients.js';

// Resolver interface so the trace store doesn't have to know about the
// werewolf_matches table layout. Phase 1's orchestrator caches game_id
// → match uuid mappings locally, so this is an O(1) Map lookup at call
// time.
export interface MatchPkResolver {
  resolveMatchPk(matchId: string): Promise<string>;
}

export interface PostgresWerewolfDecisionTraceStoreOptions {
  resolver: MatchPkResolver;
  limits?: Partial<WerewolfDecisionTraceStoreLimits>;
}

interface DecisionTraceRow {
  trace_id: string;
  match_id: string;
  sequence: number;
  request_id: string;
  agent_id: string | null;
  player_id: string;
  phase: WerewolfPhase;
  night_number: number;
  day_number: number;
  public_state_hash: string;
  private_state_hash: string;
  valid_action_types: ReadonlyArray<string>;
  response_action: WerewolfDecisionTrace['responseAction'];
  applied_action: WerewolfDecisionTrace['appliedAction'];
  latency_ms: number;
  timed_out: boolean;
  invalid_reason: string | null;
  fallback_reason: WerewolfDecisionTraceFallbackReason | null;
  reasoning_summary: WerewolfDecisionTrace['reasoningSummary'];
  created_at: string;
  // Joined from werewolf_matches via PostgREST nested select. Always
  // present because the FK is non-null.
  werewolf_matches: { game_id: string };
}

export class PostgresWerewolfDecisionTraceStore implements IWerewolfDecisionTraceStore {
  private readonly limits: WerewolfDecisionTraceStoreLimits;

  constructor(
    private readonly client: SupabaseServiceClient,
    private readonly options: PostgresWerewolfDecisionTraceStoreOptions,
  ) {
    this.limits = {
      ...DEFAULT_WEREWOLF_DECISION_TRACE_STORE_LIMITS,
      ...(options.limits ?? {}),
    };
  }

  async appendDecisionTrace(trace: WerewolfDecisionTrace): Promise<WerewolfDecisionTrace> {
    const publicTrace = toPublicWerewolfDecisionTrace(trace);
    assertSingleTraceWithinLimit(publicTrace, this.limits);

    const matchPk = await this.options.resolver.resolveMatchPk(publicTrace.matchId);

    const { count, error: countErr } = await this.client
      .from('werewolf_decision_traces')
      .select('trace_id', { count: 'exact', head: true })
      .eq('match_id', matchPk);
    if (countErr) {
      throw new Error(`countTraces failed: ${countErr.message}`);
    }
    if ((count ?? 0) >= this.limits.maxTracesPerMatch) {
      throw new ArtifactLimitExceededError(
        `Werewolf decision trace count would exceed per-match limit ${this.limits.maxTracesPerMatch}`,
      );
    }

    const row = {
      trace_id: publicTrace.traceId,
      match_id: matchPk,
      sequence: publicTrace.sequence,
      request_id: publicTrace.requestId,
      agent_id: publicTrace.agentId.length === 0 ? null : publicTrace.agentId,
      player_id: publicTrace.playerId,
      phase: publicTrace.phase,
      night_number: publicTrace.nightNumber,
      day_number: publicTrace.dayNumber,
      public_state_hash: publicTrace.publicStateHash,
      private_state_hash: publicTrace.privateStateHash,
      valid_action_types: [...publicTrace.validActionTypes],
      response_action: publicTrace.responseAction,
      applied_action: publicTrace.appliedAction,
      latency_ms: publicTrace.latencyMs,
      timed_out: publicTrace.timedOut,
      invalid_reason: publicTrace.invalidReason,
      fallback_reason: publicTrace.fallbackReason,
      reasoning_summary: publicTrace.reasoningSummary,
      created_at: new Date(publicTrace.createdAt).toISOString(),
    };

    const { error } = await this.client
      .from('werewolf_decision_traces')
      .upsert(row, { onConflict: 'match_id,sequence', ignoreDuplicates: true });
    if (error) {
      throw new Error(`appendDecisionTrace failed: ${error.message}`);
    }
    return publicTrace;
  }

  async listDecisionTraces(matchId: string): Promise<WerewolfDecisionTrace[]> {
    const matchPk = await this.options.resolver.resolveMatchPk(matchId);
    const { data, error } = await this.client
      .from('werewolf_decision_traces')
      .select(
        'trace_id, match_id, sequence, request_id, agent_id, player_id, phase, night_number, day_number, public_state_hash, private_state_hash, valid_action_types, response_action, applied_action, latency_ms, timed_out, invalid_reason, fallback_reason, reasoning_summary, created_at, werewolf_matches!inner(game_id)',
      )
      .eq('match_id', matchPk)
      .order('sequence', { ascending: true });
    if (error) throw new Error(`listDecisionTraces failed: ${error.message}`);
    return ((data ?? []) as unknown as DecisionTraceRow[]).map(rowToTrace);
  }
}

function rowToTrace(r: DecisionTraceRow): WerewolfDecisionTrace {
  return {
    traceId: r.trace_id,
    matchId: r.werewolf_matches.game_id,
    sequence: r.sequence,
    requestId: r.request_id,
    agentId: r.agent_id ?? '',
    playerId: r.player_id,
    phase: r.phase,
    nightNumber: r.night_number,
    dayNumber: r.day_number,
    publicStateHash: r.public_state_hash,
    privateStateHash: r.private_state_hash,
    validActionTypes: [...r.valid_action_types] as WerewolfDecisionTrace['validActionTypes'],
    responseAction: r.response_action,
    appliedAction: r.applied_action,
    latencyMs: r.latency_ms,
    timedOut: r.timed_out,
    invalidReason: r.invalid_reason,
    fallbackReason: r.fallback_reason,
    reasoningSummary: r.reasoning_summary,
    createdAt: new Date(r.created_at).getTime(),
  };
}

function assertSingleTraceWithinLimit(
  t: WerewolfDecisionTrace,
  limits: WerewolfDecisionTraceStoreLimits,
): void {
  const bytes = Buffer.byteLength(`${JSON.stringify(t)}\n`, 'utf-8');
  if (bytes > limits.maxTraceBytes) {
    throw new ArtifactLimitExceededError(
      `Werewolf decision trace is ${bytes} bytes; limit is ${limits.maxTraceBytes}`,
    );
  }
}
