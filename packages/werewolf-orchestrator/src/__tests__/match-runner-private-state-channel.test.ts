import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMatchRunner } from '../match-runner.js';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfPlayerId, WerewolfPrivateState } from '@agent-poker/shared';

describe('match-runner private-state channel', () => {
  it('emits {playerId, privateState} before each agent.action_requested', async () => {
    const initial = createGame({ gameId: 'g-priv', seed: 'seed-priv' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${p.id}` }),
      ]),
    );
    const emitter = new EventEmitter();

    const requestedOrder: WerewolfPlayerId[] = [];
    const privateOrder: Array<{ playerId: WerewolfPlayerId; privateState: WerewolfPrivateState }> = [];
    emitter.on('agent.action_requested', (e: { data: { playerId: WerewolfPlayerId } }) => {
      requestedOrder.push(e.data.playerId);
    });
    emitter.on('private-state', (e: { playerId: WerewolfPlayerId; privateState: WerewolfPrivateState }) => {
      privateOrder.push({ playerId: e.playerId, privateState: e.privateState });
    });

    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    expect(privateOrder.length).toBe(requestedOrder.length);
    expect(privateOrder.length).toBeGreaterThan(0);
    for (let i = 0; i < requestedOrder.length; i++) {
      expect(privateOrder[i]!.playerId).toBe(requestedOrder[i]);
      expect(privateOrder[i]!.privateState.selfId).toBe(requestedOrder[i]);
    }
  });

  it("private-state events do NOT leak into the replay-event stream", async () => {
    const initial = createGame({ gameId: 'g-priv-2', seed: 'seed-priv-2' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${p.id}` }),
      ]),
    );
    const emitter = new EventEmitter();
    const replay: Array<{ eventType: string }> = [];
    emitter.on('replay-event', (e: { eventType: string }) => replay.push(e));
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();
    expect(replay.some((e) => (e.eventType as string) === 'private-state')).toBe(false);
  });
});
