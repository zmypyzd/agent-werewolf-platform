import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMatchRunner } from '../match-runner.js';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfReplayEvent } from '../replay-event.js';

describe('match-runner emits phase on every action event', () => {
  it('agent.action_received, agent.timeout, agent.invalid_action carry the same phase as agent.action_requested', async () => {
    const initial = createGame({ gameId: 'g-phase', seed: 'seed-phase' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent({ agentId: `agent-${p.id}`, name: p.name, seed: `r-${p.id}` }),
      ]),
    );
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    const requested = events.filter((e) => e.eventType === 'agent.action_requested');
    const received = events.filter((e) => e.eventType === 'agent.action_received');
    expect(requested.length).toBeGreaterThan(0);
    expect(received.length).toBe(requested.length);

    for (const e of [...requested, ...received]) {
      expect(typeof e.data['phase']).toBe('string');
    }
  });
});
