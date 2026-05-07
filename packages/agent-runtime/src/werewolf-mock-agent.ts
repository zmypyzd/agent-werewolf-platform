import type {
  WerewolfAction,
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
    // For day-speeches the engine ships an empty-string skeleton in
    // validActions[0]. Echoing it verbatim now triggers the orchestrator's
    // empty-speech rejection (a real agent that returns the skeleton appears
    // mute on the broadcast pane). Fill a deterministic placeholder so the
    // mock represents a "minimally functional agent" rather than a broken one;
    // tests that need richer speech should wrap or replace this agent.
    const action: WerewolfAction =
      first.type === 'speak' && first.speech.length === 0
        ? { ...first, speech: 'mock speech' }
        : first;
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      action,
    };
  }
}
