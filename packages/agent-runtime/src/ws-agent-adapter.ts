import type { AgentDecisionRequest, AgentDecisionResponse } from '@agent-poker/shared';
import { NotImplementedError } from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';

export class WsAgentAdapter implements IAgent {
  constructor(
    public readonly agentId: string,
    public readonly name: string,
    public readonly endpoint: string,
  ) {}

  async requestDecision(_req: AgentDecisionRequest): Promise<AgentDecisionResponse> {
    throw new NotImplementedError('WsAgentAdapter');
  }
}
