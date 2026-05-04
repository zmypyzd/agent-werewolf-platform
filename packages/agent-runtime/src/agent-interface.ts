import type { AgentDecisionRequest, AgentDecisionResponse } from '@agent-poker/shared';

export interface IAgent<
  TReq = AgentDecisionRequest,
  TRes = AgentDecisionResponse,
> {
  readonly agentId: string;
  readonly name: string;
  requestDecision(req: TReq): Promise<TRes>;
}
