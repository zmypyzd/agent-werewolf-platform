import type { AgentDecisionRequest, AgentDecisionResponse } from '@agent-poker/shared';

export interface IAgent {
  readonly agentId: string;
  readonly name: string;
  requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse>;
}
