import type {
  ActionType,
  AgentDecisionRequest,
  AgentDecisionResponse,
} from '@agent-poker/shared';
import { ActionConflictError } from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';

export interface HumanSubmission {
  handId: string;
  actionType: ActionType;
  amount?: number;
}

interface Pending {
  request: AgentDecisionRequest;
  resolve: (r: AgentDecisionResponse) => void;
  reject: (e: Error) => void;
}

// HumanAgent is an IAgent whose decision is provided externally. Each call to
// requestDecision returns a Promise that stays unresolved until somebody calls
// submit() with a matching handId. Wrapping the agent in TimeoutHandler is what
// gives us the "default to check/fold after timeoutMs" safety net for free.
export class HumanAgent implements IAgent<AgentDecisionRequest, AgentDecisionResponse> {
  private pending: Pending | null = null;

  constructor(public readonly agentId: string, public readonly name: string) {}

  get pendingRequest(): AgentDecisionRequest | null {
    return this.pending?.request ?? null;
  }

  async requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse> {
    if (this.pending) {
      const prior = this.pending;
      this.pending = null;
      prior.reject(new Error(`HumanAgent ${this.agentId} got a new request before the prior was resolved`));
    }
    return new Promise<AgentDecisionResponse>((resolve, reject) => {
      this.pending = { request: req, resolve, reject };
    });
  }

  submit(action: HumanSubmission): void {
    const pending = this.pending;
    if (!pending) {
      throw new ActionConflictError(`HumanAgent ${this.agentId} has no pending request`);
    }
    if (action.handId !== pending.request.handId) {
      throw new ActionConflictError(
        `handId mismatch (expected ${pending.request.handId}, got ${action.handId})`,
      );
    }
    this.pending = null;
    const response: AgentDecisionResponse = {
      requestId: pending.request.requestId,
      agentId: this.agentId,
      actionType: action.actionType,
      ...(action.amount !== undefined ? { amount: action.amount } : {}),
    };
    pending.resolve(response);
  }

  cancel(reason = 'cancelled'): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.reject(new Error(reason));
  }
}
