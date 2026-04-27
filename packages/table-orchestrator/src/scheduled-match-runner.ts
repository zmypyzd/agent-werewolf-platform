import { randomUUID } from 'crypto';
import type { IHandStore, IMatchArtifactStore, ITableStore } from '@agent-poker/persistence';
import {
  AggressiveAgent,
  AlwaysCallAgent,
  AlwaysFoldAgent,
  RandomMockAgent,
} from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import { TableOrchestrator } from './orchestrator.js';

export type ScheduledMatchStrategy = 'random' | 'always-call' | 'always-fold' | 'aggressive';

export interface ScheduledMatchDefinition {
  name: string;
  seed: string;
  numHands: number;
  agents: Array<{
    name: string;
    strategy: ScheduledMatchStrategy;
    buyIn: number;
  }>;
}

export interface ScheduledMatchResult {
  matchId: string;
  handCount: number;
}

export class ScheduledMatchRunner {
  constructor(
    private readonly tableStore: ITableStore,
    private readonly handStore: IHandStore,
    private readonly matchArtifactStore: IMatchArtifactStore,
  ) {}

  async run(definition: ScheduledMatchDefinition): Promise<ScheduledMatchResult> {
    if (definition.numHands < 1 || definition.numHands > 20) {
      throw new Error('numHands must be between 1 and 20');
    }
    if (definition.agents.length < 2) {
      throw new Error('scheduled match requires at least 2 agents');
    }

    const orchestrator = new TableOrchestrator(this.tableStore, this.handStore);
    const table = await orchestrator.createTable({
      name: definition.name,
      maxSeats: Math.max(2, Math.min(9, definition.agents.length)),
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      seed: definition.seed,
      defaultTimeoutMs: 5000,
    });

    for (const agentSpec of definition.agents) {
      const agentId = `scheduled-${randomUUID().slice(0, 8)}`;
      await orchestrator.addAgent(
        table.tableId,
        { agentId, name: agentSpec.name, adapterType: 'mock' },
        this.createAgent(agentSpec.strategy, agentId, agentSpec.name),
        agentSpec.buyIn,
        { ownerUserId: `scheduled-${agentId}`, adapterType: 'mock' },
      );
    }

    const hands = await orchestrator.runSimulation(table.tableId, definition.numHands);
    const replayEvents = (
      await Promise.all(hands.map(hand => this.handStore.getReplayEvents(hand.handId)))
    ).flat();

    const artifact = await this.matchArtifactStore.saveMatchArtifact({
      matchId: table.tableId,
      tableId: table.tableId,
      name: definition.name,
      seed: definition.seed,
      hands,
      replayEvents,
    });

    return {
      matchId: artifact.manifest.matchId,
      handCount: hands.length,
    };
  }

  private createAgent(strategy: ScheduledMatchStrategy, agentId: string, name: string): IAgent {
    switch (strategy) {
      case 'always-call': return new AlwaysCallAgent(agentId, name);
      case 'always-fold': return new AlwaysFoldAgent(agentId, name);
      case 'aggressive': return new AggressiveAgent(agentId, name);
      case 'random': return new RandomMockAgent(agentId, name);
    }
  }
}
