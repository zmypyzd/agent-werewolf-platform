import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import {
  WerewolfMockAgent,
  WerewolfRandomMockAgent,
} from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';
import type { WerewolfReplayEvent } from '../replay-event.js';

type WerewolfAgent = IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;

describe('werewolf-orchestrator integration', () => {
  it('drives a complete 9-AI match (deterministic mock agents) to game-over', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-int-1',
      seed: 'int-1',
    });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const summary = await orch.runMatch(matchId);

    expect(['good', 'werewolf']).toContain(summary.winner);
    expect(summary.finalPlayers).toHaveLength(9);
    expect(summary.history.some((e) => e.type === 'game-over')).toBe(true);
    expect(summary.replayEventCount).toBeGreaterThan(0);
  });

  it('drives a complete 9-AI match (seeded random agents) to game-over', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-int-2',
      seed: 'int-2',
    });
    for (const p of initialState.players) {
      orch.registerAgent(
        matchId,
        p.id,
        new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: 'int-2' }),
      );
    }
    const summary = await orch.runMatch(matchId);
    expect(['good', 'werewolf']).toContain(summary.winner);
  });

  it('events broadcast on replay-event do not leak private fields from privateState', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-int-3',
      seed: 'int-3',
    });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const events: WerewolfReplayEvent[] = [];
    orch.subscribe(matchId, (e) => events.push(e));
    await orch.runMatch(matchId);

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const json = JSON.stringify(e.data);
      // No agent's private fields should appear in any broadcast event.
      expect(json).not.toMatch(/"selfRole":/);
      expect(json).not.toMatch(/"seerKnowledge":/);
      expect(json).not.toMatch(/"witchView":/);
      expect(json).not.toMatch(/"knownAllies":/);
      // No raw role-assigned or night-action engine history entries either.
      expect(json).not.toMatch(/"role-assigned"/);
      expect(json).not.toMatch(/"night-action"/);
    }
  });

  it('summary roles are revealed only at game-over (finalPlayers carries roles)', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-int-4',
      seed: 'int-4',
    });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const summary = await orch.runMatch(matchId);
    const wolves = summary.finalPlayers.filter((p) => p.role === 'werewolf');
    expect(wolves.length).toBeGreaterThan(0);
    const seers = summary.finalPlayers.filter((p) => p.role === 'seer');
    expect(seers).toHaveLength(1);
  });

  it('two runs with the same gameId+seed and deterministic agents produce the same winner', async () => {
    async function runOnce(): Promise<string> {
      const orch = new WerewolfOrchestrator();
      const { matchId, initialState } = orch.createMatch({ gameId: 'g-int-5', seed: 'int-5-rep' });
      for (const p of initialState.players) {
        orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
      }
      const summary = await orch.runMatch(matchId);
      return summary.winner;
    }
    const w1 = await runOnce();
    const w2 = await runOnce();
    expect(w1).toBe(w2);
  });

  it('falls back deterministically when an agent throws', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-int-6', seed: 'int-6' });
    const throwingAgent: WerewolfAgent = {
      agentId: 'thrower',
      name: 'Thrower',
      async requestDecision() {
        throw new Error('boom');
      },
    };
    for (let i = 0; i < initialState.players.length; i++) {
      const p = initialState.players[i]!;
      orch.registerAgent(
        matchId,
        p.id,
        i === 0 ? throwingAgent : new WerewolfMockAgent(`agent-${p.id}`, p.name),
      );
    }
    const events: WerewolfReplayEvent[] = [];
    orch.subscribe(matchId, (e) => events.push(e));
    const summary = await orch.runMatch(matchId);
    expect(['good', 'werewolf']).toContain(summary.winner);
    // The thrower is treated as a timeout (TimeoutHandler maps thrown errors to fallback).
    expect(events.some((e) => e.eventType === 'agent.timeout')).toBe(true);
  });
});
