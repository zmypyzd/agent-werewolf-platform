import type { AgentDecisionRequest, AgentDecisionResponse, LegalAction } from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';

export interface TimeoutResult {
  response: AgentDecisionResponse;
  timedOut: boolean;
}

function getFallbackAction(legalActions: LegalAction[], requestId: string, agentId: string): AgentDecisionResponse {
  const hasCheck = legalActions.some(a => a.type === 'check');
  return {
    requestId,
    agentId,
    actionType: hasCheck ? 'check' : 'fold',
  };
}

export class TimeoutHandler {
  constructor(
    private readonly agent: IAgent,
    private readonly timeoutMs: number,
  ) {}

  async requestDecision(req: AgentDecisionRequest): Promise<TimeoutResult> {
    return new Promise((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({
            response: getFallbackAction(req.legalActions, req.requestId, req.agentId),
            timedOut: true,
          });
        }
      }, this.timeoutMs);

      this.agent.requestDecision(req).then(response => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ response, timedOut: false });
        }
      }).catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            response: getFallbackAction(req.legalActions, req.requestId, req.agentId),
            timedOut: true,
          });
        }
      });
    });
  }
}
