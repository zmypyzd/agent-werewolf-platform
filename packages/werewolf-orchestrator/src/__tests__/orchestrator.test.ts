import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import { WerewolfMockAgent } from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';
import type { WerewolfReplayEvent } from '../replay-event.js';

type WerewolfAgent = IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;

describe('WerewolfOrchestrator', () => {
  it('createMatch returns matchId and initial state with 9 players in seat order', () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-orch-1',
      seed: 'seed-orch-1',
    });
    expect(matchId).toBe('g-orch-1');
    expect(initialState.players).toHaveLength(9);
    for (let i = 0; i < 9; i++) {
      expect(initialState.players[i]!.seatIndex).toBe(i);
      expect(initialState.players[i]!.id).toBe(`p${i + 1}`);
    }
  });

  it('runMatch throws when not all 9 agents are registered', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-2', seed: 'seed-orch-2' });
    // Only register 8 agents
    for (let i = 0; i < 8; i++) {
      orch.registerAgent(matchId, initialState.players[i]!.id, new WerewolfMockAgent(`a${i}`, 'X'));
    }
    await expect(orch.runMatch(matchId)).rejects.toThrow(/missing agent/);
  });

  it('runMatch drives 9 mock agents to game-over and stashes the summary', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-3', seed: 'seed-orch-3' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const summary = await orch.runMatch(matchId);
    expect(['good', 'werewolf']).toContain(summary.winner);
    expect(orch.getMatchSummary(matchId)).toEqual(summary);
  });

  it('runMatch emits events on the per-match emitter', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-4', seed: 'seed-orch-4' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const events: WerewolfReplayEvent[] = [];
    orch.subscribe(matchId, (e) => events.push(e));
    await orch.runMatch(matchId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.eventType).toBe('match.started');
    expect(events[events.length - 1]!.eventType).toBe('match.completed');
  });

  it('createMatch with duplicate gameId throws', () => {
    const orch = new WerewolfOrchestrator();
    orch.createMatch({ gameId: 'dup', seed: 's1' });
    expect(() => orch.createMatch({ gameId: 'dup', seed: 's2' })).toThrow(/already exists/);
  });

  it('registerAgent throws for unknown matchId', () => {
    const orch = new WerewolfOrchestrator();
    expect(() =>
      orch.registerAgent('does-not-exist', 'p1', new WerewolfMockAgent('a', 'A')),
    ).toThrow(/unknown match/);
  });

  it('registerAgent throws for unknown playerId', () => {
    const orch = new WerewolfOrchestrator();
    const { matchId } = orch.createMatch({ gameId: 'g-orch-5', seed: 's5' });
    expect(() =>
      orch.registerAgent(matchId, 'p99', new WerewolfMockAgent('a', 'A')),
    ).toThrow(/unknown player/);
  });

  it('runMatch throws if invoked twice on the same matchId', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-6', seed: 'seed-orch-6' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    await orch.runMatch(matchId);
    await expect(orch.runMatch(matchId)).rejects.toThrow(/already (run|completed)/i);
  });

  it('getMatchSummary returns null for unknown matchId', () => {
    const orch = new WerewolfOrchestrator();
    expect(orch.getMatchSummary('does-not-exist')).toBeNull();
  });
});
