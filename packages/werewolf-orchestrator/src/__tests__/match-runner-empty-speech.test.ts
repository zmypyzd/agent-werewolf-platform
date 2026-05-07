import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfGameState,
} from '@agent-poker/shared';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMockAgent } from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import { WerewolfMatchRunner } from '../match-runner.js';
import type { WerewolfReplayEvent } from '../replay-event.js';

type WerewolfAgent = IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;

// Wraps a real mock agent: on day-speeches phases it overrides the speak
// action's `speech` field to "" (or "   "). Other phases pass through.
// This simulates the issue reported by external bot WerewolfBot9: an agent
// that returns the validActions[0] template unchanged, ending up with
// empty public speech.
function buildAgentsWithEmptySpeechSeat(
  state: WerewolfGameState,
  emptySeatId: string,
  overrideSpeech: string,
): Map<string, WerewolfAgent> {
  const m = new Map<string, WerewolfAgent>();
  for (const p of state.players) {
    const base = new WerewolfMockAgent(`agent-${p.id}`, p.name);
    if (p.id !== emptySeatId) {
      m.set(p.id, base);
      continue;
    }
    const wrapped: WerewolfAgent = {
      agentId: base.agentId,
      name: base.name,
      async requestDecision(req) {
        const res = await base.requestDecision(req);
        if (req.phase === 'day-speeches' && res.action.type === 'speak') {
          return {
            ...res,
            action: {
              ...res.action,
              speech: overrideSpeech,
            },
          };
        }
        return res;
      },
    };
    m.set(p.id, wrapped);
  }
  return m;
}

describe('WerewolfMatchRunner — empty-speech rejection', () => {
  it('routes empty-string speech into agent.invalid_action with reason "empty-speech"', async () => {
    const initial = createGame({
      gameId: 'g-empty-speech-1',
      seed: 'seed-empty-speech-1',
    });
    const muteId = initial.players[0]!.id;
    const agents = buildAgentsWithEmptySpeechSeat(initial, muteId, '');
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));

    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    const invalids = events.filter((e) => e.eventType === 'agent.invalid_action');
    const emptySpeech = invalids.filter(
      (e) => (e.data as { reason?: string }).reason === 'empty-speech',
    );
    expect(emptySpeech.length).toBeGreaterThanOrEqual(1);
    // The schema-failure flag must NOT be set — speak with empty speech is
    // structurally valid by the wire schema; this is a runtime semantic
    // rejection.
    for (const ev of emptySpeech) {
      expect((ev.data as { schemaFailure?: boolean }).schemaFailure).not.toBe(true);
    }
  });

  it('also rejects whitespace-only speech', async () => {
    const initial = createGame({
      gameId: 'g-empty-speech-2',
      seed: 'seed-empty-speech-2',
    });
    const muteId = initial.players[1]!.id;
    const agents = buildAgentsWithEmptySpeechSeat(initial, muteId, '   \n\t  ');
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));

    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    const emptySpeech = events.filter(
      (e) =>
        e.eventType === 'agent.invalid_action' &&
        (e.data as { reason?: string }).reason === 'empty-speech',
    );
    expect(emptySpeech.length).toBeGreaterThanOrEqual(1);
  });

  it('does not reject speak with non-empty speech (regression — happy path stays happy)', async () => {
    const initial = createGame({
      gameId: 'g-empty-speech-3',
      seed: 'seed-empty-speech-3',
    });
    // Default mock agents fill in non-trivial speech → no empty-speech rejection.
    const agents = new Map<string, WerewolfAgent>();
    for (const p of initial.players) {
      agents.set(p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));

    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    const emptySpeech = events.filter(
      (e) =>
        e.eventType === 'agent.invalid_action' &&
        (e.data as { reason?: string }).reason === 'empty-speech',
    );
    expect(emptySpeech.length).toBe(0);
  });
});
