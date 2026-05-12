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

    // Counter-based "should-not-fire" sentinel. The previous form of this
    // test threw inside the listener and relied on the throw propagating
    // out of runMatch — that pattern was silently broken when subscribe()
    // started wrapping listeners in try/catch for error isolation, since
    // the wrapper swallows synchronous throws by design. Use an explicit
    // call counter and `expect(...).toBe(0)` so a regressed `unsubscribe()`
    // surfaces as a counter mismatch instead of being silenced.
    let listenerCallCount = 0;
    const unsubscribe = orch.subscribePrivate(matchId, () => {
      listenerCallCount += 1;
    });
    unsubscribe();

    await expect(orch.runMatch(matchId)).resolves.toBeDefined();
    expect(listenerCallCount).toBe(0);
  });

  it('throws when subscribePrivate is called for an unknown matchId', () => {
    const orch = new WerewolfOrchestrator();
    expect(() => orch.subscribePrivate('does-not-exist', () => {})).toThrow(/unknown match/);
  });
});
