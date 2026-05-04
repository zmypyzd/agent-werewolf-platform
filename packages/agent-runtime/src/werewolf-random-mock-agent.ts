import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';
import { createSeededRng } from './werewolf-prng.js';

export interface WerewolfRandomMockAgentOptions {
  // When provided, picks become deterministic across runs with the same seed.
  // Each call to requestDecision advances the RNG by one number.
  readonly seed?: string;
}

export class WerewolfRandomMockAgent
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  private readonly rng: () => number;

  constructor(
    public readonly agentId: string,
    public readonly name: string,
    options?: WerewolfRandomMockAgentOptions,
  ) {
    this.rng = options?.seed
      ? createSeededRng(`${options.seed}-${agentId}`)
      : Math.random;
  }

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    if (req.validActions.length === 0) {
      throw new Error(
        `WerewolfRandomMockAgent ${this.agentId}: no valid action in phase ${req.phase}`,
      );
    }
    const idx = Math.floor(this.rng() * req.validActions.length);
    const chosen = req.validActions[idx]!;
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      action: chosen,
    };
  }
}
