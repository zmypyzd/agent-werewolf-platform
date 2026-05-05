import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMatchRunner } from '../match-runner.js';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfPlayerId, WerewolfPrivateState } from '@agent-poker/shared';

describe('match-runner private-state channel', () => {
  it('emits {playerId, privateState} immediately before each agent.action_requested', async () => {
    const initial = createGame({ gameId: 'g-priv', seed: 'seed-priv' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${p.id}` }),
      ]),
    );
    const emitter = new EventEmitter();

    type LogEntry =
      | { kind: 'private'; playerId: WerewolfPlayerId; selfId: WerewolfPlayerId }
      | { kind: 'requested'; playerId: WerewolfPlayerId };
    const log: LogEntry[] = [];
    emitter.on('private-state', (e: { playerId: WerewolfPlayerId; privateState: WerewolfPrivateState }) => {
      log.push({ kind: 'private', playerId: e.playerId, selfId: e.privateState.selfId });
    });
    emitter.on('agent.action_requested', (e: { data: { playerId: WerewolfPlayerId } }) => {
      log.push({ kind: 'requested', playerId: e.data.playerId });
    });

    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    // Expect strict pair structure: private-state[i], agent.action_requested[i+1].
    expect(log.length).toBeGreaterThan(0);
    expect(log.length % 2).toBe(0);
    for (let i = 0; i < log.length; i += 2) {
      const priv = log[i]!;
      const req = log[i + 1]!;
      expect(priv.kind).toBe('private');
      expect(req.kind).toBe('requested');
      // Same player on both halves of the pair.
      expect(priv.playerId).toBe(req.playerId);
      // privateState carries that player's view.
      if (priv.kind === 'private') {
        expect(priv.selfId).toBe(priv.playerId);
      }
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
    expect(replay.some((e) => e.eventType === 'private-state')).toBe(false);
  });
});
