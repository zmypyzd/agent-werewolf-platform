import type { AgentDecisionRequest, AgentDecisionResponse, LegalAction } from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';

export abstract class MockAgent implements IAgent {
  constructor(
    public readonly agentId: string,
    public readonly name: string,
  ) {}

  abstract requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse>;

  protected fallbackAction(req: AgentDecisionRequest): AgentDecisionResponse {
    const hasCheck = req.legalActions.some(a => a.type === 'check');
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      actionType: hasCheck ? 'check' : 'fold',
    };
  }

  protected firstLegal(req: AgentDecisionRequest, preferred: string[]): LegalAction | undefined {
    for (const pref of preferred) {
      const found = req.legalActions.find(a => a.type === pref);
      if (found) return found;
    }
    return req.legalActions[0];
  }
}
