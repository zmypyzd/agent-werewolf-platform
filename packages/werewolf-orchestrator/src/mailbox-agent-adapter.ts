import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfReasoningSummary,
} from '@agent-poker/shared';
import {
  WerewolfActionSchema,
  WerewolfDecisionResponseSchema,
  WerewolfReasoningSummarySchema,
} from '@agent-poker/agent-protocol';
import type { IAgent } from '@agent-poker/agent-runtime';
import type { IWerewolfDecisionMailbox } from '@agent-poker/persistence';

// Per-match sequence allocator. The orchestrator's WerewolfMatchRunner
// already maintains a monotonic counter for decision traces; the same
// counter is reused here so the mailbox row's `sequence` aligns with the
// trace's sequence (and the DB's unique(match_id, sequence) constraint
// is satisfied without coordination across multiple adapter instances).
export interface SequenceAllocator {
  next(): number;
}

export class CounterSequenceAllocator implements SequenceAllocator {
  private value = 0;
  next(): number {
    this.value += 1;
    return this.value;
  }
}

export interface WerewolfMailboxAgentAdapterOptions {
  readonly agentId: string;
  readonly name: string;
  readonly matchPk: string;
  readonly mailbox: IWerewolfDecisionMailbox;
  readonly sequenceAllocator: SequenceAllocator;
  // How long the request stays claimable in the mailbox. Once exceeded, a
  // subsequent /v1/wait won't return it; the cron sweep marks it expired.
  // Default 60s — werewolf decisions are slower than poker.
  readonly ttlSeconds?: number;
  // How long this adapter waits before giving up on the agent. Maps to the
  // per-call agent timeout that match-runner already enforces, so set this
  // <= match-runner's timeoutMs to stay inside the trace's notion of
  // "timed out". Default 30s.
  readonly waitTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

const DEFAULT_TTL_SECONDS = 60;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

// Bridge between the in-process IAgent dispatch in WerewolfMatchRunner and
// the cross-instance decision mailbox. Each requestDecision() call writes
// one row into werewolf_decision_requests, blocks on werewolf_decision_actions
// until the agent runner submits, then returns the response.
//
// On timeout the adapter throws — match-runner.ts catches and routes to
// werewolfFallback() exactly as it does for in-process timeouts. The
// existing fallback path (and decision-trace recording) is unchanged.
export class WerewolfMailboxAgentAdapter
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  public readonly agentId: string;
  public readonly name: string;
  private readonly matchPk: string;
  private readonly mailbox: IWerewolfDecisionMailbox;
  private readonly sequenceAllocator: SequenceAllocator;
  private readonly ttlSeconds: number;
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(opts: WerewolfMailboxAgentAdapterOptions) {
    this.agentId = opts.agentId;
    this.name = opts.name;
    this.matchPk = opts.matchPk;
    this.mailbox = opts.mailbox;
    this.sequenceAllocator = opts.sequenceAllocator;
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.waitTimeoutMs = opts.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    const sequence = this.sequenceAllocator.next();

    const enqueued = await this.mailbox.enqueueRequest({
      matchPk: this.matchPk,
      sequence,
      playerId: req.playerId,
      agentId: this.agentId,
      phase: req.phase,
      // The full WerewolfDecisionRequest is serialized as state_json; the
      // agent runner reads it back, calls its strategy, and submits a
      // matching WerewolfDecisionResponse. The schema-level redaction
      // (privateState) is already correct at this point — match-runner
      // built the request with the per-player getPrivateState().
      statePayload: req as unknown as Record<string, unknown>,
      ttlSeconds: this.ttlSeconds,
    });

    const action = await this.mailbox.waitForAction(enqueued.requestId, {
      pollIntervalMs: this.pollIntervalMs,
      timeoutMs: this.waitTimeoutMs,
    });

    if (action === null) {
      // Mark the request as aborted so a slow agent that lands the action
      // after our timeout doesn't dangle in 'pending' (cron sweeps would
      // pick it up too, but explicit is faster).
      await this.mailbox.cancelRequest(enqueued.requestId).catch(() => {});
      throw new Error(
        `WerewolfMailboxAgentAdapter ${this.agentId}: agent did not respond within ${this.waitTimeoutMs}ms`,
      );
    }

    // The mailbox payload is `unknown` to the DB. Validate against the
    // wire schema before returning so match-runner can trust the response
    // shape (it re-validates anyway, but failing here gives a clearer
    // error and avoids a redundant fallback path).
    const actionParsed = WerewolfActionSchema.safeParse(action.action);
    if (!actionParsed.success) {
      throw new Error(
        `WerewolfMailboxAgentAdapter ${this.agentId}: action payload failed schema validation (${actionParsed.error.message})`,
      );
    }

    const reasoning =
      action.reasoningSummary === null
        ? undefined
        : WerewolfReasoningSummarySchema.safeParse(action.reasoningSummary);
    if (reasoning && !reasoning.success) {
      throw new Error(
        `WerewolfMailboxAgentAdapter ${this.agentId}: reasoning summary failed schema validation (${reasoning.error.message})`,
      );
    }

    const response: WerewolfDecisionResponse = {
      requestId: req.requestId,
      agentId: this.agentId,
      action: actionParsed.data,
      ...(reasoning && reasoning.success
        ? { reasoningSummary: toReasoningSummary(reasoning.data) }
        : {}),
    };

    // Final defence-in-depth: round-trip through the response schema.
    // match-runner will repeat this check, so a failure here would just
    // get caught one frame up. Worth doing locally to surface mailbox
    // payload bugs at the originating adapter.
    const verified = WerewolfDecisionResponseSchema.safeParse(response);
    if (!verified.success) {
      throw new Error(
        `WerewolfMailboxAgentAdapter ${this.agentId}: assembled response failed schema validation (${verified.error.message})`,
      );
    }
    return response;
  }
}

function toReasoningSummary(
  parsed: ReturnType<typeof WerewolfReasoningSummarySchema.parse>,
): WerewolfReasoningSummary {
  return {
    intent: parsed.intent,
    confidence: parsed.confidence,
    keyObservations: [...parsed.keyObservations],
  };
}
