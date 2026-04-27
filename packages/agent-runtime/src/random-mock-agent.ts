import type { AgentDecisionRequest, AgentDecisionResponse } from '@agent-poker/shared';
import { MockAgent } from './mock-agent.js';

export class RandomMockAgent extends MockAgent {
  async requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse> {
    const actions = req.legalActions;
    if (actions.length === 0) return this.fallbackAction(req);

    const chosen = actions[Math.floor(Math.random() * actions.length)]!;
    let amount: number | undefined;

    if (chosen.type === 'bet' || chosen.type === 'raise') {
      const min = chosen.minAmount ?? 0;
      const max = chosen.maxAmount ?? min;
      amount = min + Math.floor(Math.random() * (max - min + 1));
    } else if (chosen.type === 'all-in') {
      amount = chosen.maxAmount;
    }

    return {
      requestId: req.requestId,
      agentId: this.agentId,
      actionType: chosen.type,
      ...(amount !== undefined ? { amount } : {}),
    };
  }
}

export class AlwaysCallAgent extends MockAgent {
  async requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse> {
    const action = this.firstLegal(req, ['call', 'check', 'fold']);
    if (!action) return this.fallbackAction(req);
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      actionType: action.type,
    };
  }
}

export class AlwaysFoldAgent extends MockAgent {
  async requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse> {
    const action = this.firstLegal(req, ['fold', 'check']);
    if (!action) return this.fallbackAction(req);
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      actionType: action.type,
    };
  }
}

export class AggressiveAgent extends MockAgent {
  async requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse> {
    const allin = req.legalActions.find(a => a.type === 'all-in');
    if (allin) {
      return {
        requestId: req.requestId,
        agentId: this.agentId,
        actionType: 'all-in',
        ...(allin.maxAmount !== undefined ? { amount: allin.maxAmount } : {}),
      };
    }
    const raise = req.legalActions.find(a => a.type === 'raise');
    if (raise) {
      return {
        requestId: req.requestId,
        agentId: this.agentId,
        actionType: 'raise',
        amount: raise.maxAmount ?? raise.minAmount ?? 0,
      };
    }
    const action = this.firstLegal(req, ['bet', 'call', 'check', 'fold']);
    if (!action) return this.fallbackAction(req);
    let amount: number | undefined;
    if (action.type === 'bet') amount = action.maxAmount ?? action.minAmount;
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      actionType: action.type,
      ...(amount !== undefined ? { amount } : {}),
    };
  }
}
