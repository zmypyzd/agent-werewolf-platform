import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';

export class WerewolfMockAgent
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  constructor(
    public readonly agentId: string,
    public readonly name: string,
  ) {}

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    const first = req.validActions[0];
    if (!first) {
      throw new Error(
        `WerewolfMockAgent ${this.agentId}: no valid action in phase ${req.phase} for player ${req.playerId}`,
      );
    }
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      action: first,
    };
  }
}
