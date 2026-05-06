import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import { NotImplementedError } from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';

export class WerewolfWsAgentAdapter
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  constructor(
    public readonly agentId: string,
    public readonly name: string,
    public readonly endpoint: string,
  ) {}

  async requestDecision(_req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    throw new NotImplementedError('WerewolfWsAgentAdapter');
  }
}
