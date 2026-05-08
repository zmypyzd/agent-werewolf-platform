import {
  WerewolfActionSchema,
  WerewolfDecisionRequestSchema,
  WerewolfReasoningSummarySchema,
} from '@agent-poker/agent-protocol';
import type {
  WerewolfAction,
  WerewolfDecisionRequest,
  WerewolfReasoningSummary,
} from '@agent-poker/shared';

// External-agent SDK side of the mailbox. This file deliberately has zero
// runtime dependencies on @supabase/supabase-js — agent runners ship as
// thin clients that talk only to the platform API. The orchestrator
// (Render, service-role) is the one with DB access; the API tier
// (apps/api) authenticates the agent token, looks up the mailbox row,
// and proxies it back through these endpoints.
//
// Endpoints assumed (defined by apps/api in Phase 1):
//   GET  {baseUrl}/api/v1/werewolf/wait?agent_id=…
//        → 200 { mailboxRequestId, request: WerewolfDecisionRequest } | 204 (no work)
//   POST {baseUrl}/api/v1/werewolf/action
//        body { mailboxRequestId, action, reasoningSummary? } → 204

export interface WerewolfMailboxClaim {
  readonly mailboxRequestId: string;
  readonly request: WerewolfDecisionRequest;
}

export interface WerewolfDecisionOutput {
  readonly action: WerewolfAction;
  readonly reasoningSummary?: WerewolfReasoningSummary;
}

export interface WerewolfMailboxRunnerOptions {
  readonly baseUrl: string;
  readonly agentId: string;
  // Raw agent token. The platform stores sha256(token); the runner
  // presents the raw value as a Bearer credential on every request.
  readonly authToken: string;
  // User strategy. Receives the WerewolfDecisionRequest, returns the
  // WerewolfAction (and optional reasoning summary). Throwing here is
  // recoverable — the runner logs the error and skips this request, so
  // the orchestrator's wait timeout fires and falls back. To kill the
  // loop, abort the signal.
  readonly decide: (req: WerewolfDecisionRequest) => Promise<WerewolfDecisionOutput>;
  // Idle backoff between empty /wait responses. Default 1000ms.
  readonly idlePollMs?: number;
  // Backoff after a transport/HTTP error. Default 2000ms — long enough to
  // ride out a brief API blip without hammering.
  readonly errorBackoffMs?: number;
  // Per-call HTTP timeout for /wait. Default 25s. Should sit just under
  // any HTTP edge timeout the runner's host imposes.
  readonly waitTimeoutMs?: number;
  // Per-call HTTP timeout for /action submission. Default 10s.
  readonly submitTimeoutMs?: number;
  readonly signal?: AbortSignal;
  // Observability hooks. None of these are required.
  readonly onError?: (err: Error, ctx: 'wait' | 'decide' | 'submit') => void;
  readonly onClaim?: (claim: WerewolfMailboxClaim) => void;
  readonly onIdle?: () => void;
  // Optional logger; falls back to silence (the consumer's onError covers
  // the surface we care about).
  readonly logger?: (msg: string) => void;
}

const DEFAULT_IDLE_POLL_MS = 1000;
const DEFAULT_ERROR_BACKOFF_MS = 2000;
const DEFAULT_WAIT_TIMEOUT_MS = 25_000;
const DEFAULT_SUBMIT_TIMEOUT_MS = 10_000;

interface WaitResponseBody {
  mailboxRequestId: string;
  request: unknown;
}

export class WerewolfMailboxRunner {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly authToken: string;
  private readonly decide: (req: WerewolfDecisionRequest) => Promise<WerewolfDecisionOutput>;
  private readonly idlePollMs: number;
  private readonly errorBackoffMs: number;
  private readonly waitTimeoutMs: number;
  private readonly submitTimeoutMs: number;
  private readonly signal: AbortSignal | undefined;
  private readonly onError: WerewolfMailboxRunnerOptions['onError'];
  private readonly onClaim: WerewolfMailboxRunnerOptions['onClaim'];
  private readonly onIdle: WerewolfMailboxRunnerOptions['onIdle'];
  private readonly logger: WerewolfMailboxRunnerOptions['logger'];

  constructor(opts: WerewolfMailboxRunnerOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.agentId = opts.agentId;
    this.authToken = opts.authToken;
    this.decide = opts.decide;
    this.idlePollMs = opts.idlePollMs ?? DEFAULT_IDLE_POLL_MS;
    this.errorBackoffMs = opts.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS;
    this.waitTimeoutMs = opts.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.submitTimeoutMs = opts.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
    this.signal = opts.signal;
    this.onError = opts.onError;
    this.onClaim = opts.onClaim;
    this.onIdle = opts.onIdle;
    this.logger = opts.logger;
  }

  // Long-running loop. Returns when the AbortSignal aborts. Caller can
  // run() and ignore the promise, or await it for graceful shutdown.
  async run(): Promise<void> {
    while (!this.aborted()) {
      try {
        const claim = await this.waitOnce();
        if (claim === null) {
          this.onIdle?.();
          await this.sleep(this.idlePollMs);
          continue;
        }
        this.onClaim?.(claim);
        await this.processClaim(claim);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.onError?.(e, 'wait');
        this.logger?.(`werewolf-mailbox-runner: wait error: ${e.message}`);
        await this.sleep(this.errorBackoffMs);
      }
    }
  }

  // Single-claim entry point — useful for tests and one-shot callers.
  // Returns null when no work is available.
  async waitOnce(): Promise<WerewolfMailboxClaim | null> {
    const url = `${this.baseUrl}/api/v1/werewolf/wait?agent_id=${encodeURIComponent(this.agentId)}`;
    const resp = await this.fetchWithTimeout(url, { method: 'GET' }, this.waitTimeoutMs);
    if (resp.status === 204) return null;
    if (!resp.ok) {
      throw new Error(`/wait HTTP ${resp.status}`);
    }
    const body = (await resp.json()) as WaitResponseBody;
    if (typeof body.mailboxRequestId !== 'string' || body.mailboxRequestId.length === 0) {
      throw new Error(`/wait response missing mailboxRequestId`);
    }
    const parsed = WerewolfDecisionRequestSchema.safeParse(body.request);
    if (!parsed.success) {
      throw new Error(`/wait response.request failed schema validation: ${parsed.error.message}`);
    }
    return {
      mailboxRequestId: body.mailboxRequestId,
      request: parsed.data as WerewolfDecisionRequest,
    };
  }

  async submit(claim: WerewolfMailboxClaim, output: WerewolfDecisionOutput): Promise<void> {
    const actionParsed = WerewolfActionSchema.safeParse(output.action);
    if (!actionParsed.success) {
      throw new Error(`submit: action failed schema validation: ${actionParsed.error.message}`);
    }
    const summaryEnvelope: { reasoningSummary?: WerewolfReasoningSummary } = {};
    if (output.reasoningSummary !== undefined) {
      const r = WerewolfReasoningSummarySchema.safeParse(output.reasoningSummary);
      if (!r.success) {
        throw new Error(`submit: reasoningSummary failed schema validation: ${r.error.message}`);
      }
      summaryEnvelope.reasoningSummary = {
        intent: r.data.intent,
        confidence: r.data.confidence,
        keyObservations: [...r.data.keyObservations],
      };
    }

    const url = `${this.baseUrl}/api/v1/werewolf/action`;
    const resp = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mailboxRequestId: claim.mailboxRequestId,
          action: actionParsed.data,
          ...summaryEnvelope,
        }),
      },
      this.submitTimeoutMs,
    );
    if (resp.status !== 204 && !resp.ok) {
      throw new Error(`/action HTTP ${resp.status}`);
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private async processClaim(claim: WerewolfMailboxClaim): Promise<void> {
    let output: WerewolfDecisionOutput;
    try {
      output = await this.decide(claim.request);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.onError?.(e, 'decide');
      this.logger?.(
        `werewolf-mailbox-runner: decide error for ${claim.mailboxRequestId}: ${e.message}`,
      );
      // Skip submission; orchestrator's wait timeout will fall back. This
      // is intentional — submitting a bogus action would corrupt the
      // game, whereas a missed deadline lands cleanly in werewolfFallback.
      return;
    }

    try {
      await this.submit(claim, output);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.onError?.(e, 'submit');
      this.logger?.(
        `werewolf-mailbox-runner: submit error for ${claim.mailboxRequestId}: ${e.message}`,
      );
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onParentAbort = () => controller.abort();
    this.signal?.addEventListener('abort', onParentAbort, { once: true });

    const headers = new Headers(init.headers ?? {});
    headers.set('authorization', `Bearer ${this.authToken}`);
    headers.set('accept', 'application/json');

    try {
      return await fetch(url, { ...init, headers, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) {
        if (this.aborted()) {
          throw new Error('werewolf-mailbox-runner: aborted');
        }
        throw new Error(`werewolf-mailbox-runner: request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      this.signal?.removeEventListener('abort', onParentAbort);
    }
  }

  private aborted(): boolean {
    return this.signal?.aborted === true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      this.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
