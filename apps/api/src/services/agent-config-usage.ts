import type { TableOrchestrator } from '@agent-poker/table-orchestrator';
import type { WerewolfLobbyRegistry } from '../werewolf-lobby-registry.js';

// Cross-game in-use joiner. Lets DELETE /me/agents/:id reject if the agent is
// seated in any live game (poker table OR werewolf lobby). Plan decision D3=C
// — keeps the check in-memory across orchestrators rather than denormalizing
// into the SQLite store, mirroring the existing poker-only pattern at the
// callsite without forcing a schema migration. Adding a third game = one more
// .isAgentConfigInUse() call here, no callsite churn.
export class AgentConfigUsageService {
  constructor(
    private readonly pokerOrchestrator: TableOrchestrator,
    private readonly werewolfRegistry: WerewolfLobbyRegistry,
  ) {}

  isInUse(agentConfigId: string): boolean {
    return (
      this.pokerOrchestrator.isAgentConfigInUse(agentConfigId) ||
      this.werewolfRegistry.isAgentConfigInUse(agentConfigId)
    );
  }
}
