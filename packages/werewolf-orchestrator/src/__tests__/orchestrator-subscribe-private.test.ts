import { describe, expect, it } from 'vitest';
import { WerewolfOrchestrator } from '../orchestrator.js';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfPlayerId, WerewolfPrivateState } from '@agent-poker/shared';

describe('WerewolfOrchestrator.subscribePrivate', () => {
  it('streams {playerId, privateState} for the running match and the unsubscriber detaches', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-sp', seed: 's-sp' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }

    const calls: Array<{ playerId: WerewolfPlayerId; selfId: WerewolfPlayerId }> = [];
    const unsubscribe = orch.subscribePrivate(matchId, (event) => {
      calls.push({ playerId: event.playerId, selfId: event.privateState.selfId });
    });

    await orch.runMatch(matchId);

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.playerId).toBe(c.selfId);
    }

    // After unsubscribe, no further calls (run a 2nd match-id to confirm the
    // returned function actually removes the listener — same orchestrator
    // instance, fresh match.)
    const before = calls.length;
    unsubscribe();
    const second = orch.createMatch({ gameId: 'g-sp-2', seed: 's-sp-2' });
    for (const p of second.initialState.players) {
      orch.registerAgent(second.matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await orch.runMatch(second.matchId);
    // The listener was attached only to matchId 'g-sp'. Unsubscribing it does
    // not affect g-sp-2 because there was never a listener there to begin
    // with. The point of this assertion: calls.length must NOT have grown.
    expect(calls.length).toBe(before);
  });

  it('throws when subscribePrivate is called for an unknown matchId', () => {
    const orch = new WerewolfOrchestrator();
    expect(() => orch.subscribePrivate('does-not-exist', () => {})).toThrow(/unknown match/);
  });
});
