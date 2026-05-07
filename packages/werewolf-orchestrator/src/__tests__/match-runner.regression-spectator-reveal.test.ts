import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMatchRunner } from '../match-runner.js';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfReplayEvent } from '../replay-event.js';

// Regression: ISSUE-005 — spectator surface should be a "broadcast view" that
// reveals every player's role/side from match-start. The minimal mechanism
// is to enrich the existing `match.started` event with role/side per
// player; the realtime topic that carries this is already public-only and
// not a channel agents use to receive private info (agents read from the
// decision-request envelope, which redacts), so the info-isolation
// invariant for live play is preserved.

const KNOWN_ROLES = new Set(['werewolf', 'villager', 'seer', 'witch', 'hunter']);
const KNOWN_SIDES = new Set(['good', 'werewolf']);

async function runAndFindMatchStarted(seed: string): Promise<WerewolfReplayEvent> {
  const initial = createGame({ gameId: `g-${seed}`, seed });
  const agents = new Map(
    initial.players.map((p) => [
      p.id,
      new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${seed}-${p.id}` }),
    ]),
  );
  const emitter = new EventEmitter();
  const events: WerewolfReplayEvent[] = [];
  emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
  const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
  await runner.run();
  const started = events.find((e) => e.eventType === 'match.started');
  if (!started) throw new Error('expected match.started event');
  return started;
}

describe('match-runner — spectator role reveal on match.started', () => {
  it('match.started carries role + side for every player', async () => {
    const started = await runAndFindMatchStarted('reveal-seed-a');
    const players = started.data['players'];
    expect(Array.isArray(players)).toBe(true);
    const arr = players as ReadonlyArray<Record<string, unknown>>;
    expect(arr.length).toBe(9);
    for (const p of arr) {
      expect(typeof p['id']).toBe('string');
      expect(typeof p['seatIndex']).toBe('number');
      expect(typeof p['name']).toBe('string');
      expect(typeof p['role']).toBe('string');
      expect(typeof p['side']).toBe('string');
      expect(KNOWN_ROLES.has(p['role'] as string)).toBe(true);
      expect(KNOWN_SIDES.has(p['side'] as string)).toBe(true);
    }
  });

  it('werewolf players have side="werewolf" and others side="good"', async () => {
    const started = await runAndFindMatchStarted('reveal-seed-b');
    const arr = started.data['players'] as ReadonlyArray<Record<string, unknown>>;
    for (const p of arr) {
      const role = p['role'] as string;
      const side = p['side'] as string;
      if (role === 'werewolf') expect(side).toBe('werewolf');
      else expect(side).toBe('good');
    }
  });

  it('emits exactly 3 werewolves in a 9-player game (engine contract held)', async () => {
    // Defensive: if anyone changes the role-deal in createGame this test
    // catches it; the spectator UI assumes 3 wolves in its visual treatment.
    const started = await runAndFindMatchStarted('reveal-seed-c');
    const arr = started.data['players'] as ReadonlyArray<Record<string, unknown>>;
    const wolves = arr.filter((p) => p['role'] === 'werewolf');
    expect(wolves.length).toBe(3);
  });
});
