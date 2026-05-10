import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import type { WerewolfGameState } from '@agent-poker/shared';

// Regression / adversarial coverage: witch-saves-self when wolves target her.
//
// The audit (overnight QA Round 5) flagged this as the only real coverage
// gap in the witch state machine — apply-action.ts:99 already permits the
// witch to save herself when she is the wolf-kill target, and phases.ts:46
// already de-duplicates the save (kill !== save → no death). The logic was
// correct but no test exercised the path. A future "tighten the save-self
// rule" rewrite (some werewolf rule sets forbid first-night save-self, some
// forbid it entirely) would silently change the engine behaviour without
// tripping a test failure.
//
// Pin the v1 house-rule contract: save-self is allowed, every night, with
// no extra restriction. Both the directly-observable outcomes (witch alive,
// no death-event recorded) and the witch-internal state (potion consumed,
// night-action history record) are asserted.

function setupNight(): WerewolfGameState {
  const base = createGame({ gameId: 'witch-save-self', seed: 'seed-witch-save-self' });
  return startFirstNight(base);
}

describe('applyAction — witch saves herself when wolves target her', () => {
  it('witch survives the night when she is the wolf-kill target and chooses save', () => {
    let s = setupNight();
    const witch = s.players.find((p) => p.role === 'witch')!;
    const wolves = s.players.filter((p) => p.role === 'werewolf');

    for (const w of wolves) {
      s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: witch.id });
    }
    expect(s.phase).toBe('night-witch');
    expect(s.pendingNight.werewolfVotes[wolves[0]!.id]).toBe(witch.id);

    s = applyAction(s, { type: 'witch-save', targetId: witch.id });
    expect(s.witchPotions.hasSave).toBe(false);
    expect(s.pendingNight.witchSaved).toBe(witch.id);

    s = applyAction(s, { type: 'witch-skip-poison' });
    expect(s.phase).toBe('night-seer');

    const wolf = wolves[0]!;
    s = applyAction(s, { type: 'seer-divine', targetId: wolf.id });

    // Night resolves synchronously; witch must still be alive.
    const witchAfter = s.players.find((p) => p.id === witch.id)!;
    expect(witchAfter.alive).toBe(true);

    // No death event was emitted for the witch this night.
    const deathEvents = s.history.filter(
      (e) => e.type === 'death' && e.playerId === witch.id,
    );
    expect(deathEvents).toEqual([]);

    // History pinpoints the resolved night-action: wolves targeted the
    // witch and the witch saved herself.
    const lastNight = [...s.history].reverse().find((e) => e.type === 'night-action');
    expect(lastNight).toBeDefined();
    if (lastNight?.type === 'night-action') {
      expect(lastNight.record.werewolfTarget).toBe(witch.id);
      expect(lastNight.record.witchSaved).toBe(witch.id);
    }

    // Sanity: the seer divination was unaffected.
    if (lastNight?.type === 'night-action') {
      expect(lastNight.record.seerTarget).toBe(wolf.id);
      expect(lastNight.record.seerResult).toBe('werewolf');
    }
  });

  it('control: witch dies when wolves target her and she chooses skip-save', () => {
    let s = setupNight();
    const witch = s.players.find((p) => p.role === 'witch')!;
    const wolves = s.players.filter((p) => p.role === 'werewolf');

    for (const w of wolves) {
      s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: witch.id });
    }
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });

    s = applyAction(s, { type: 'seer-divine', targetId: wolves[0]!.id });

    // Save potion was untouched (still available next night).
    expect(s.witchPotions.hasSave).toBe(true);

    const witchAfter = s.players.find((p) => p.id === witch.id)!;
    expect(witchAfter.alive).toBe(false);

    const deathEvent = s.history.find(
      (e) => e.type === 'death' && e.playerId === witch.id,
    );
    expect(deathEvent).toBeDefined();
    if (deathEvent?.type === 'death') {
      expect(deathEvent.cause).toBe('wolf-kill');
    }
  });
});
