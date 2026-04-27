import type { AgentDecisionRequest, AgentDecisionResponse, ReasoningSummary } from '@agent-poker/shared';
import { AgentDecisionResponseSchema } from '@agent-poker/agent-protocol';
import type { AgentDecisionResponseZod } from '@agent-poker/agent-protocol';
import type { IAgent } from './agent-interface.js';

export interface HttpAgentAdapterOptions {
  agentId: string;
  name: string;
  endpointUrl: string;
  authHeaderName?: string | null;
  authHeaderValue?: string | null;
  // Per-call timeout. The orchestrator's TimeoutHandler also enforces a timeout
  // at a higher level, so this acts as a fast-fail bound on the network call
  // even if the wrapper's clock has not fired yet.
  timeoutMs: number;
}

export class HttpAgentAdapter implements IAgent {
  public readonly agentId: string;
  public readonly name: string;
  public readonly endpointUrl: string;
  private readonly authHeaderName: string | null;
  private readonly authHeaderValue: string | null;
  private readonly timeoutMs: number;

  constructor(opts: HttpAgentAdapterOptions) {
    this.agentId = opts.agentId;
    this.name = opts.name;
    this.endpointUrl = opts.endpointUrl;
    this.authHeaderName = opts.authHeaderName ?? null;
    this.authHeaderValue = opts.authHeaderValue ?? null;
    this.timeoutMs = opts.timeoutMs;
  }

  async requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse> {
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
          ? `HttpAgentAdapter ${this.agentId}: request aborted (timeout ${this.timeoutMs}ms)`
          : `HttpAgentAdapter ${this.agentId}: network error ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      throw new Error(`HttpAgentAdapter ${this.agentId}: HTTP ${resp.status}`);
    }

    let raw: unknown;
    try {
      raw = await resp.json();
    } catch (err) {
      throw new Error(`HttpAgentAdapter ${this.agentId}: malformed JSON body (${(err as Error).message})`);
    }

    const parsed = AgentDecisionResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `HttpAgentAdapter ${this.agentId}: response does not match AgentDecisionResponseSchema (${parsed.error.message})`,
      );
    }
    const { requestId, agentId, actionType, amount, reasoningSummary } = parsed.data;
    return {
      requestId,
      agentId,
      actionType,
      ...(amount !== undefined ? { amount } : {}),
      ...(reasoningSummary !== undefined ? { reasoningSummary: toReasoningSummary(reasoningSummary) } : {}),
    };
  }
}

function toReasoningSummary(summary: NonNullable<AgentDecisionResponseZod['reasoningSummary']>): ReasoningSummary {
  return {
    intent: summary.intent,
    confidence: summary.confidence,
    riskLevel: summary.riskLevel,
    keyObservations: [...summary.keyObservations],
    consideredActions: summary.consideredActions.map(action => ({
      actionType: action.actionType,
      ...(action.amount !== undefined ? { amount: action.amount } : {}),
      reason: action.reason,
    })),
  };
}
