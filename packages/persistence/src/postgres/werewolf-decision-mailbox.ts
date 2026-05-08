import type { WerewolfPhase } from '@agent-poker/shared';
import type { SupabaseServiceClient } from './supabase-clients.js';

// Cross-instance agent dispatch. The orchestrator (Render, long-lived) and
// the API tier (Vercel, stateless) cannot share memory, so this client
// wraps the durable mailbox tables defined in
// supabase/migrations/20260508020000_werewolf_decision_mailbox.sql.
//
//   Orchestrator side: enqueueRequest → waitForAction
//   Agent runner side: claimNextRequest → submitAction
//
// Both sides must use a SupabaseServiceClient. RLS denies all access to
// anon/authenticated callers; only service-role bypasses.

export type MailboxRequestStatus = 'pending' | 'fulfilled' | 'expired' | 'aborted';

export interface MailboxEnqueueInput {
  readonly matchPk: string;
  readonly sequence: number;
  readonly playerId: string;
  readonly agentId: string | null;
  readonly phase: WerewolfPhase;
  readonly statePayload: Record<string, unknown>;
  readonly ttlSeconds: number;
}

export interface MailboxRequestRow {
  readonly requestId: string;
  readonly matchPk: string;
  readonly sequence: number;
  readonly playerId: string;
  readonly agentId: string | null;
  readonly phase: WerewolfPhase;
  readonly statePayload: Record<string, unknown>;
  readonly enqueuedAt: number;
  readonly expiresAt: number;
  readonly status: MailboxRequestStatus;
  readonly fulfilledAt: number | null;
}

export interface MailboxActionRow {
  readonly requestId: string;
  readonly matchPk: string;
  readonly agentId: string | null;
  readonly action: Record<string, unknown>;
  readonly reasoningSummary: Record<string, unknown> | null;
  readonly submittedAt: number;
}

export interface MailboxSubmitInput {
  readonly requestId: string;
  readonly agentId: string | null;
  readonly action: Record<string, unknown>;
  readonly reasoningSummary?: Record<string, unknown> | null;
  // Optional explicit matchPk. When omitted, the mailbox looks up the
  // request row to derive it (one extra round-trip, but allows the API
  // tier to call submitAction with only the request id from the agent).
  // Pass it explicitly only when the caller already knows the value
  // (e.g. tests, in-process orchestrator paths).
  readonly matchPk?: string;
}

export class MailboxOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailboxOwnershipError';
  }
}

export interface MailboxWaitOptions {
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

// Public interface — extracted so tests and alternative backends (e.g. an
// in-memory loopback for local-sim) can substitute the Postgres-backed
// implementation without dragging in the Supabase client.
export interface IWerewolfDecisionMailbox {
  enqueueRequest(input: MailboxEnqueueInput): Promise<MailboxRequestRow>;
  waitForAction(
    requestId: string,
    options?: MailboxWaitOptions,
  ): Promise<MailboxActionRow | null>;
  cancelRequest(requestId: string): Promise<void>;
  expireOverdue(): Promise<number>;
  claimNextRequest(
    agentId: string,
    leaseSeconds?: number,
  ): Promise<MailboxRequestRow | null>;
  submitAction(input: MailboxSubmitInput): Promise<void>;
}

interface RawRequestRow {
  request_id: string;
  match_id: string;
  sequence: number;
  player_id: string;
  agent_id: string | null;
  phase: WerewolfPhase;
  state_json: Record<string, unknown>;
  enqueued_at: string;
  expires_at: string;
  status: MailboxRequestStatus;
  fulfilled_at: string | null;
}

interface RawActionRow {
  request_id: string;
  match_id: string;
  agent_id: string | null;
  action_json: Record<string, unknown>;
  reasoning_summary: Record<string, unknown> | null;
  submitted_at: string;
}

export class WerewolfDecisionMailbox implements IWerewolfDecisionMailbox {
  constructor(private readonly client: SupabaseServiceClient) {}

  // ─── Orchestrator side ────────────────────────────────────────────────

  async enqueueRequest(input: MailboxEnqueueInput): Promise<MailboxRequestRow> {
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
    const { data, error } = await this.client
      .from('werewolf_decision_requests')
      .insert({
        match_id: input.matchPk,
        sequence: input.sequence,
        player_id: input.playerId,
        agent_id: input.agentId,
        phase: input.phase,
        state_json: input.statePayload,
        expires_at: expiresAt,
      })
      .select(
        'request_id, match_id, sequence, player_id, agent_id, phase, state_json, enqueued_at, expires_at, status, fulfilled_at',
      )
      .single();
    if (error) {
      // 23505 = duplicate (match_id, sequence). The orchestrator retried; the
      // existing row is the authoritative one — fetch and return it.
      if (error.code === '23505') {
        const { data: existing, error: fetchErr } = await this.client
          .from('werewolf_decision_requests')
          .select(
            'request_id, match_id, sequence, player_id, agent_id, phase, state_json, enqueued_at, expires_at, status, fulfilled_at',
          )
          .eq('match_id', input.matchPk)
          .eq('sequence', input.sequence)
          .single();
        if (fetchErr || !existing) {
          throw new Error(`enqueueRequest: idempotent fetch failed: ${fetchErr?.message ?? 'no row'}`);
        }
        return rawToRequest(existing as unknown as RawRequestRow);
      }
      throw new Error(`enqueueRequest failed: ${error.message}`);
    }
    return rawToRequest(data as unknown as RawRequestRow);
  }

  // Block until a matching action lands or the deadline elapses. Returns
  // null on timeout — caller falls back to werewolf-fallback.ts.
  async waitForAction(
    requestId: string,
    options: MailboxWaitOptions = {},
  ): Promise<MailboxActionRow | null> {
    const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (options.signal?.aborted) return null;
      const action = await this.findAction(requestId);
      if (action !== null) {
        await this.markFulfilled(requestId);
        return action;
      }
      await sleep(pollMs, options.signal);
    }
    return null;
  }

  async cancelRequest(requestId: string): Promise<void> {
    const { error } = await this.client
      .from('werewolf_decision_requests')
      .update({ status: 'aborted' })
      .eq('request_id', requestId)
      .eq('status', 'pending');
    if (error) throw new Error(`cancelRequest failed: ${error.message}`);
  }

  async expireOverdue(): Promise<number> {
    const { data, error } = await this.client.rpc('expire_old_werewolf_decision_requests');
    if (error) throw new Error(`expireOverdue failed: ${error.message}`);
    return typeof data === 'number' ? data : 0;
  }

  // ─── Agent runner side (called from /api/v1/wait + /api/v1/action) ────

  // Atomic claim using the migration's claim_next_werewolf_decision_request
  // RPC (FOR UPDATE SKIP LOCKED). Two concurrent /v1/wait calls from the
  // same agent runner won't race; one gets the row, the other gets null.
  async claimNextRequest(
    agentId: string,
    leaseSeconds = 30,
  ): Promise<MailboxRequestRow | null> {
    const { data, error } = await this.client.rpc(
      'claim_next_werewolf_decision_request',
      { p_agent_id: agentId, p_lease_seconds: leaseSeconds },
    );
    if (error) throw new Error(`claimNextRequest failed: ${error.message}`);
    if (!data) return null;
    return rawToRequest(data as unknown as RawRequestRow);
  }

  async submitAction(input: MailboxSubmitInput): Promise<void> {
    let matchPk = input.matchPk;
    if (matchPk === undefined) {
      const { data, error } = await this.client
        .from('werewolf_decision_requests')
        .select('match_id, agent_id')
        .eq('request_id', input.requestId)
        .maybeSingle();
      if (error) throw new Error(`submitAction lookup failed: ${error.message}`);
      if (!data) {
        throw new MailboxOwnershipError(
          `submitAction: no decision request ${input.requestId}`,
        );
      }
      const row = data as { match_id: string; agent_id: string | null };
      // Ownership: the agent submitting must match the agent the
      // request was enqueued for. Without this check, any authenticated
      // agent could submit on any request — corrupting the wrong match.
      if (input.agentId !== null && row.agent_id !== null && row.agent_id !== input.agentId) {
        throw new MailboxOwnershipError(
          `submitAction: request ${input.requestId} belongs to a different agent`,
        );
      }
      matchPk = row.match_id;
    }

    const { error } = await this.client.from('werewolf_decision_actions').insert({
      request_id: input.requestId,
      match_id: matchPk,
      agent_id: input.agentId,
      action_json: input.action,
      reasoning_summary: input.reasoningSummary ?? null,
    });
    if (error) {
      // 23505 = duplicate request_id — the agent already submitted. Treat
      // as success (idempotent), the orchestrator will use the first.
      if (error.code === '23505') return;
      throw new Error(`submitAction failed: ${error.message}`);
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────────

  private async findAction(requestId: string): Promise<MailboxActionRow | null> {
    const { data, error } = await this.client
      .from('werewolf_decision_actions')
      .select('request_id, match_id, agent_id, action_json, reasoning_summary, submitted_at')
      .eq('request_id', requestId)
      .maybeSingle();
    if (error) throw new Error(`findAction failed: ${error.message}`);
    if (!data) return null;
    return rawToAction(data as unknown as RawActionRow);
  }

  private async markFulfilled(requestId: string): Promise<void> {
    const { error } = await this.client
      .from('werewolf_decision_requests')
      .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
      .eq('request_id', requestId)
      .eq('status', 'pending');
    if (error) throw new Error(`markFulfilled failed: ${error.message}`);
  }
}

function rawToRequest(r: RawRequestRow): MailboxRequestRow {
  return {
    requestId: r.request_id,
    matchPk: r.match_id,
    sequence: r.sequence,
    playerId: r.player_id,
    agentId: r.agent_id,
    phase: r.phase,
    statePayload: r.state_json,
    enqueuedAt: new Date(r.enqueued_at).getTime(),
    expiresAt: new Date(r.expires_at).getTime(),
    status: r.status,
    fulfilledAt: r.fulfilled_at ? new Date(r.fulfilled_at).getTime() : null,
  };
}

function rawToAction(r: RawActionRow): MailboxActionRow {
  return {
    requestId: r.request_id,
    matchPk: r.match_id,
    agentId: r.agent_id,
    action: r.action_json,
    reasoningSummary: r.reasoning_summary,
    submittedAt: new Date(r.submitted_at).getTime(),
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
