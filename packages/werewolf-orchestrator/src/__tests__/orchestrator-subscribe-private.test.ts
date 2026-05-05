import { describe, expect, it } from 'vitest';
import { WerewolfOrchestrator } from '../orchestrator.js';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfPlayerId } from '@agent-poker/shared';

describe('WerewolfOrchestrator.subscribePrivate', () => {
  it('streams {playerId, privateState} for the running match', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-sp', seed: 's-sp' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }

    const calls: Array<{ playerId: WerewolfPlayerId; selfId: WerewolfPlayerId }> = [];
    orch.subscribePrivate(matchId, (event) => {
      calls.push({ playerId: event.playerId, selfId: event.privateState.selfId });
    });

    await orch.runMatch(matchId);

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.playerId).toBe(c.selfId);
    }
  });

  it('the unsubscriber detaches the listener before the match runs', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-sp-detach', seed: 's-sp-detach' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }

    // Listener that fails the test if called. We unsubscribe immediately, so
    // running the match must NOT invoke it. If unsubscribe() were a no-op,
    // this listener would throw and propagate out of orch.runMatch.
    const unsubscribe = orch.subscribePrivate(matchId, () => {
      throw new Error('listener should have been detached before runMatch');
    });
    unsubscribe();

    await expect(orch.runMatch(matchId)).resolves.toBeDefined();
  });

  it('throws when subscribePrivate is called for an unknown matchId', () => {
    const orch = new WerewolfOrchestrator();
    expect(() => orch.subscribePrivate('does-not-exist', () => {})).toThrow(/unknown match/);
  });
});
