import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';
import {
  AgentOfflineError,
  type AgentConnectionRegistry,
} from './agent-connection-registry.js';

// Server-side IAgent for the reverse-WS transport. The agent process
// established an outbound WS to /api/v1/agents/connect; this adapter
// looks up that connection in the registry at dispatch time and runs
// one RPC over it. There is no per-call timeout here — the orchestrator
// already wraps requestDecision in TimeoutHandler, and the underlying
// AgentConnection.rpc has its own hard ceiling.
//
// Throws AgentOfflineError if no connection is registered. Match-runner
// catches this and the orchestrator falls back via werewolfFallback,
// same as the HTTP adapter throwing on connection refused.
export class WerewolfWsAgentAdapter
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  constructor(
    public readonly agentId: string,
    public readonly name: string,
    private readonly registry: AgentConnectionRegistry,
  ) {}

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    const conn = this.registry.acquire(this.agentId);
    if (!conn) throw new AgentOfflineError(this.agentId);
    return conn.rpc(req);
  }
}
