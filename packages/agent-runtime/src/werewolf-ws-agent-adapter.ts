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
//
// agentId vs registryKey
// ──────────────────────
// `agentId` is the identity the orchestrator + decision-trace see.
// `registryKey` is what the AgentConnectionRegistry indexes by, which
// is always the postgres `agents.id` UUID (set in agents-ws.ts at
// upgrade time). For most callers (buildAgentForRecord, direct unit
// tests) the two are the same and `registryKey` can be omitted.
//
// The werewolf-lobby seat path needs them split: it assigns a synthetic
// per-seat `agent-${playerId}` as the orchestrator agentId (matching
// the convention HTTP agents already use) but must look up the WS
// connection by the agent's postgres UUID. Passing the UUID explicitly
// as `registryKey` keeps both identity models clean instead of forcing
// the orchestrator to learn UUIDs.
export class WerewolfWsAgentAdapter
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  private readonly registryKey: string;

  constructor(
    public readonly agentId: string,
    public readonly name: string,
    private readonly registry: AgentConnectionRegistry,
    registryKey?: string,
  ) {
    this.registryKey = registryKey ?? agentId;
  }

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    const conn = this.registry.acquire(this.registryKey);
    if (!conn) throw new AgentOfflineError(this.registryKey);
    return conn.rpc(req);
  }
}
