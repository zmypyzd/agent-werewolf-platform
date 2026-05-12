import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfReasoningSummary,
} from '@agent-poker/shared';
import { WerewolfDecisionResponseSchema } from '@agent-poker/agent-protocol';
import type { IAgent } from './agent-interface.js';

export interface WerewolfHttpAgentAdapterOptions {
  agentId: string;
  name: string;
  endpointUrl: string;
  authHeaderName?: string | null;
  authHeaderValue?: string | null;
  // Per-call timeout. The runner's TimeoutHandler also enforces a higher-level
  // timeout, so this acts as a fast-fail bound on the network call itself.
  timeoutMs: number;
}

export class WerewolfHttpAgentAdapter
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  public readonly agentId: string;
  public readonly name: string;
  public readonly endpointUrl: string;
  private readonly authHeaderName: string | null;
  private readonly authHeaderValue: string | null;
  private readonly timeoutMs: number;

  constructor(opts: WerewolfHttpAgentAdapterOptions) {
    this.agentId = opts.agentId;
    this.name = opts.name;
    this.endpointUrl = opts.endpointUrl;
    this.authHeaderName = opts.authHeaderName ?? null;
    this.authHeaderValue = opts.authHeaderValue ?? null;
    this.timeoutMs = opts.timeoutMs;
  }

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.authHeaderName && this.authHeaderValue) {
      headers[this.authHeaderName] = this.authHeaderValue;
    }

    let resp: Response;
    try {
      resp = await fetch(this.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        controller.signal.aborted
          ? `WerewolfHttpAgentAdapter ${this.agentId}: request aborted (timeout ${this.timeoutMs}ms)`
          : `WerewolfHttpAgentAdapter ${this.agentId}: network error ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      // Drain the unread body before throwing. Node's undici fetch holds
      // the underlying socket open until the body is consumed or
      // cancelled — even on a 5xx response. Without an explicit cancel,
      // the connection lingers in the pool until GC runs (which can be
      // tens of seconds), and a slow / stalled remote endpoint that
      // sends headers + dribbles body bytes pins the socket indefinitely.
      // In high-concurrency matches (9-player werewolf games, many
      // concurrent decisions) repeated 5xx responses could exhaust the
      // global Agent socket pool and stall later requestDecision() calls
      // even for healthy endpoints. `body?.cancel()` returns a Promise
      // we explicitly ignore — drain is best-effort, the throw below is
      // the authoritative signal to the caller.
      void resp.body?.cancel().catch(() => {
        /* swallow: drain failure is not actionable from the call-site */
      });
      throw new Error(`WerewolfHttpAgentAdapter ${this.agentId}: HTTP ${resp.status}`);
    }

    let raw: unknown;
    try {
      raw = await resp.json();
    } catch (err) {
      throw new Error(
        `WerewolfHttpAgentAdapter ${this.agentId}: malformed JSON body (${(err as Error).message})`,
      );
    }

    const parsed = WerewolfDecisionResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `WerewolfHttpAgentAdapter ${this.agentId}: response does not match WerewolfDecisionResponseSchema (${parsed.error.message})`,
      );
    }
    const { requestId, agentId, action, reasoningSummary } = parsed.data;
    return {
      requestId,
      agentId,
      action,
      ...(reasoningSummary !== undefined
        ? { reasoningSummary: toReasoningSummary(reasoningSummary) }
        : {}),
    };
  }
}

function toReasoningSummary(
  summary: NonNullable<
    ReturnType<typeof WerewolfDecisionResponseSchema.parse>['reasoningSummary']
  >,
): WerewolfReasoningSummary {
  return {
    intent: summary.intent,
    confidence: summary.confidence,
    keyObservations: [...summary.keyObservations],
  };
}
