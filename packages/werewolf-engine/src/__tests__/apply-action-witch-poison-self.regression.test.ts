import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import { getValidActions } from '../valid-actions.js';
import { InvalidWerewolfActionError, type WerewolfGameState } from '@agent-poker/shared';

// Regression / adversarial coverage: witch-poison-self must be rejected at
// the engine boundary, not just hidden from the valid-actions menu.
//
// valid-actions.ts:64 builds witch-poison options from aliveNonSelf(...) so
// the offered action list never includes the witch as a target. But agents
// (HTTP / WS / longpoll) construct the JSON action body themselves — they
// can submit any well-typed action regardless of what valid-actions offered.
// The engine is the trust boundary; if apply-action accepts a witch-poison
// with targetId === witch.id, a misbehaving (or compromised) agent can make
// the witch suicide, wasting the poison potion and removing the role from
// the game by side-effect. valid-actions.ts and apply-action.ts must agree
// on target constraints so the menu cannot be bypassed.
//
// The sibling case (seer-divine self-target) is already rejected at
// apply-action.ts:167 with `target.id === seer.id`. This test pins the
// parallel guard for witch-poison.

function setupPoisonReady(): { state: WerewolfGameState; witchId: string; victimId: string } {
  const base = createGame({
    gameId: 'witch-poison-self',
    seed: 'seed-witch-poison-self',
  });
  let s = startFirstNight(base);
  const witch = s.players.find((p) => p.role === 'witch')!;
  const wolves = s.players.filter((p) => p.role === 'werewolf');
  // Pick a wolf-kill target that is NOT the witch, so the witch survives the
  // save phase and reaches poison without the poison branch being elided.
  const nonWitchVictim = s.players.find(
    (p) => p.role !== 'witch' && p.role !== 'werewolf',
  )!;

  for (const w of wolves) {
    s = applyAction(s, {
      type: 'werewolf-vote',
      voterId: w.id,
      targetId: nonWitchVictim.id,
    });
  }
  // Skip save so the witch advances to the poison sub-decision.
  s = applyAction(s, { type: 'witch-skip-save' });
  return { state: s, witchId: witch.id, victimId: nonWitchVictim.id };
}

describe('applyAction — witch-poison rejects self-target', () => {
  it('throws InvalidWerewolfActionError when witch poisons herself', () => {
    const { state, witchId } = setupPoisonReady();
    expect(state.phase).toBe('night-witch');
    expect(state.pendingNight.witchSaveDecisionMade).toBe(true);
    expect(state.witchPotions.hasPoison).toBe(true);

    expect(() =>
      applyAction(state, { type: 'witch-poison', targetId: witchId }),
    ).toThrow(InvalidWerewolfActionError);
  });

  it('does not consume the poison potion when self-target is rejected', () => {
    const { state, witchId } = setupPoisonReady();
    try {
      applyAction(state, { type: 'witch-poison', targetId: witchId });
    } catch {
      // expected
    }
    // applyAction is pure; the caller's state object must be unchanged. In
    // particular hasPoison stays true and pendingNight.witchPoisoned stays
    // null, so a subsequent valid poison still works.
    expect(state.witchPotions.hasPoison).toBe(true);
    expect(state.pendingNight.witchPoisoned).toBeNull();
  });

  it('positive control: witch CAN poison a non-self target', () => {
    const { state, victimId } = setupPoisonReady();
    const next = applyAction(state, { type: 'witch-poison', targetId: victimId });
    expect(next.witchPotions.hasPoison).toBe(false);
    expect(next.pendingNight.witchPoisoned).toBe(victimId);
  });

  it('valid-actions never offers witch-poison with self target (menu-side guard)', () => {
    const { state, witchId } = setupPoisonReady();
    const offered = getValidActions(state, witchId);
    const poisonOptions = offered.filter((a) => a.type === 'witch-poison');
    expect(poisonOptions.length).toBeGreaterThan(0);
    for (const opt of poisonOptions) {
      if (opt.type === 'witch-poison') {
        expect(opt.targetId).not.toBe(witchId);
      }
    }
  });
});
