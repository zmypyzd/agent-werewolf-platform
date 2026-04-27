import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import type { AgentDecisionRequest, AgentDecisionResponse, BlindConfig, GameState, ReasoningSummary } from '@agent-poker/shared';
import { AlwaysCallAgent } from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import {
  MemoryDecisionTraceStore,
  MemoryHandStore,
  MemoryTableStore,
} from '@agent-poker/persistence';
import { createShuffledDeck } from '@agent-poker/poker-engine';
import { HandRunner } from '../hand-runner.js';
import { TableOrchestrator } from '../orchestrator.js';

const BLIND_CONFIG: BlindConfig = { smallBlind: 25, bigBlind: 50, ante: 0 };
const SHA256_RE = /^[a-f0-9]{64}$/;

const reasoningSummary: ReasoningSummary = {
  intent: 'pot_control',
  confidence: 0.6,
  riskLevel: 'low',
  keyObservations: ['No need to grow the pot out of position'],
  consideredActions: [
    { actionType: 'call', reason: 'Continues with a capped range' },
    { actionType: 'fold', reason: 'Avoids marginal spots' },
  ],
};

class ReasoningAgent implements IAgent {
  constructor(
    readonly agentId: string,
    readonly name: string,
  ) {}

  async requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse> {
    const legal = req.legalActions.find(action => action.type === 'call') ??
      req.legalActions.find(action => action.type === 'check') ??
      req.legalActions.find(action => action.type === 'fold') ??
      req.legalActions[0]!;
    return {
      requestId: req.requestId,
      agentId: req.agentId,
      actionType: legal.type,
      ...(legal.type === 'call' && legal.callAmount !== undefined ? { amount: legal.callAmount } : {}),
      reasoningSummary,
    };
  }
}

class InvalidAgent implements IAgent {
  constructor(
    readonly agentId: string,
    readonly name: string,
  ) {}

  async requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse> {
    return {
      requestId: req.requestId,
      agentId: req.agentId,
      actionType: 'bet',
      amount: 9_999_999,
      reasoningSummary: {
        ...reasoningSummary,
        keyObservations: ['This summary is public and bounded'],
      },
    };
  }
}

class NeverAgent implements IAgent {
  constructor(
    readonly agentId: string,
    readonly name: string,
  ) {}

  async requestDecision(_req: AgentDecisionRequest): Promise<AgentDecisionResponse> {
    return new Promise(() => {});
  }
}

async function createTraceableOrchestrator(
  firstAgent: IAgent,
  secondAgent: IAgent,
  defaultTimeoutMs = 100,
) {
  const tableStore = new MemoryTableStore();
  const handStore = new MemoryHandStore();
  const decisionTraceStore = new MemoryDecisionTraceStore();
  const orch = new TableOrchestrator(tableStore, handStore, null, decisionTraceStore);
  const table = await orch.createTable({
    name: 'Trace Test',
    maxSeats: 2,
    blindConfig: BLIND_CONFIG,
    defaultTimeoutMs,
    seed: 'trace-seed',
  });

  await orch.addAgent(
    table.tableId,
    { agentId: firstAgent.agentId, name: firstAgent.name, adapterType: 'mock' },
    firstAgent,
    1000,
  );
  await orch.addAgent(
    table.tableId,
    { agentId: secondAgent.agentId, name: secondAgent.name, adapterType: 'mock' },
    secondAgent,
    1000,
  );

  return { orch, table, decisionTraceStore };
}

function makeDirectGameState(): GameState & { bigBlind: number } {
  return {
    handId: 'hand-001-missing',
    tableId: 'tbl-missing',
    phase: 'preflop',
    deck: createShuffledDeck('missing-agent-seed'),
    players: [
      {
        playerId: 'player-a',
        seatIndex: 0,
        agentId: 'agent-a',
        stackBefore: 1000,
        stack: 1000,
        status: 'active',
        totalBetInHand: 0,
        currentRoundBet: 0,
        holeCards: null,
      },
      {
        playerId: 'player-b',
        seatIndex: 1,
        agentId: 'agent-b',
        stackBefore: 1000,
        stack: 1000,
        status: 'active',
        totalBetInHand: 0,
        currentRoundBet: 0,
        holeCards: null,
      },
    ],
    communityCards: [],
    pots: [],
    button: 0,
    smallBlindIndex: 0,
    bigBlindIndex: 1,
    currentBettingRound: null,
    allActions: [],
    handNumber: 1,
    seed: 'missing-agent-seed',
    bigBlind: 50,
  };
}

describe('runtime decision trace capture', () => {
  it('records normal decision traces with public hashes and structured reasoning summaries', async () => {
    const { orch, table, decisionTraceStore } = await createTraceableOrchestrator(
      new AlwaysCallAgent('caller', 'Caller'),
      new ReasoningAgent('reasoner', 'Reasoner'),
    );

    await orch.startHand(table.tableId);

    const traces = await decisionTraceStore.listDecisionTraces(table.tableId);
    const trace = traces.find(item => item.reasoningSummary !== null);

    expect(trace).toBeDefined();
    expect(trace?.matchId).toBe(table.tableId);
    expect(trace?.publicStateHash).toMatch(SHA256_RE);
    expect(trace?.privateStateHash).toMatch(SHA256_RE);
    expect(trace?.responseAction).not.toBeNull();
    expect(trace?.actionId).toEqual(expect.any(String));
    expect(trace?.timedOut).toBe(false);
    expect(trace?.invalidReason).toBeNull();
    expect(trace?.appliedAction.fallbackReason).toBeUndefined();
    expect(trace?.reasoningSummary?.intent).toBe('pot_control');
    expect(JSON.stringify(trace)).not.toContain('holeCards');
    expect(JSON.stringify(trace)).not.toContain('rawChainOfThought');
  });

  it('records timeout fallback traces', async () => {
    const { orch, table, decisionTraceStore } = await createTraceableOrchestrator(
      new AlwaysCallAgent('caller', 'Caller'),
      new NeverAgent('slow', 'Slow'),
      20,
    );

    await orch.startHand(table.tableId);

    const traces = await decisionTraceStore.listDecisionTraces(table.tableId);
    const timeoutTrace = traces.find(trace => trace.timedOut);

    expect(timeoutTrace).toBeDefined();
    expect(timeoutTrace?.agentId).toBe('slow');
    expect(timeoutTrace?.responseAction).not.toBeNull();
    expect(timeoutTrace?.appliedAction.fallbackReason).toBe('timeout');
    expect(timeoutTrace?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records invalid action fallback traces with the original response action', async () => {
    const { orch, table, decisionTraceStore } = await createTraceableOrchestrator(
      new AlwaysCallAgent('caller', 'Caller'),
      new InvalidAgent('invalid', 'Invalid'),
    );

    await orch.startHand(table.tableId);

    const traces = await decisionTraceStore.listDecisionTraces(table.tableId);
    const invalidTrace = traces.find(trace => trace.invalidReason !== null);

    expect(invalidTrace).toBeDefined();
    expect(invalidTrace?.agentId).toBe('invalid');
    expect(invalidTrace?.responseAction).toEqual({ actionType: 'bet', amount: 9_999_999 });
    expect(invalidTrace?.appliedAction.fallbackReason).toBe('invalid_action');
    expect(invalidTrace?.invalidReason).toEqual(expect.any(String));
    expect(invalidTrace?.reasoningSummary?.keyObservations).toEqual([
      'This summary is public and bounded',
    ]);
  });

  it('records missing-agent fallback traces and preserves the applied action in the hand summary', async () => {
    const handStore = new MemoryHandStore();
    const decisionTraceStore = new MemoryDecisionTraceStore();
    const runner = new HandRunner(
      makeDirectGameState(),
      new Map(),
      handStore,
      new EventEmitter(),
      100,
      decisionTraceStore,
    );

    const summary = await runner.run();
    const traces = await decisionTraceStore.listDecisionTraces('tbl-missing');

    expect(traces).toHaveLength(1);
    expect(traces[0]!.agentId).toBe('agent-a');
    expect(traces[0]!.responseAction).toBeNull();
    expect(traces[0]!.appliedAction.fallbackReason).toBe('missing_agent');
    expect(traces[0]!.actionId).toEqual(expect.any(String));
    expect(summary.allActions.map(action => action.actionId)).toContain(traces[0]!.actionId);
  });
});
