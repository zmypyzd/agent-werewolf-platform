import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import type { WerewolfGameState } from '@agent-poker/shared';
import { InvalidWerewolfActionError, WerewolfPhaseError } from '@agent-poker/shared';

function setupNight(): WerewolfGameState {
  const base = createGame({ gameId: 'g1', seed: 'seed-A' });
  return startFirstNight(base);
}

function rolePlayers(s: WerewolfGameState, role: 'werewolf' | 'seer' | 'witch' | 'hunter') {
  return s.players.filter((p) => p.role === role);
}

describe('applyAction — night phase', () => {
  it('startFirstNight transitions setup → night-werewolf-vote', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s = startFirstNight(base);
    expect(s.phase).toBe('night-werewolf-vote');
    expect(s.nightNumber).toBe(1);
  });

  it('werewolf-vote records each vote and transitions to night-witch when all wolves voted', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const target = s.players.find((p) => p.role !== 'werewolf')!;
    s = applyAction(s, { type: 'werewolf-vote', voterId: wolves[0]!.id, targetId: target.id });
    expect(s.phase).toBe('night-werewolf-vote');
    expect(s.pendingNight.werewolfVotes[wolves[0]!.id]).toBe(target.id);
    s = applyAction(s, { type: 'werewolf-vote', voterId: wolves[1]!.id, targetId: target.id });
    s = applyAction(s, { type: 'werewolf-vote', voterId: wolves[2]!.id, targetId: target.id });
    expect(s.phase).toBe('night-witch');
  });

  it('werewolf-vote rejects non-werewolf voter', () => {
    const s = setupNight();
    const villager = s.players.find((p) => p.role === 'villager')!;
    const target = s.players.find((p) => p.role === 'werewolf')!;
    expect(() =>
      applyAction(s, { type: 'werewolf-vote', voterId: villager.id, targetId: target.id }),
    ).toThrow(InvalidWerewolfActionError);
  });

  it('werewolf-vote rejects targeting another werewolf', () => {
    const s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    expect(() =>
      applyAction(s, { type: 'werewolf-vote', voterId: wolves[0]!.id, targetId: wolves[1]!.id }),
    ).toThrow(InvalidWerewolfActionError);
  });

  it('witch-skip-save then witch-skip-poison transitions to night-seer', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const target = s.players.find((p) => p.role !== 'werewolf')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: target.id });
    expect(s.phase).toBe('night-witch');
    s = applyAction(s, { type: 'witch-skip-save' });
    expect(s.phase).toBe('night-witch');
    s = applyAction(s, { type: 'witch-skip-poison' });
    expect(s.phase).toBe('night-seer');
  });

  it('witch-save consumes the save potion and marks pendingNight.witchSaved', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const target = s.players.find((p) => p.role !== 'werewolf')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: target.id });
    s = applyAction(s, { type: 'witch-save', targetId: target.id });
    expect(s.witchPotions.hasSave).toBe(false);
    expect(s.pendingNight.witchSaved).toBe(target.id);
    s = applyAction(s, { type: 'witch-skip-poison' });
    expect(s.phase).toBe('night-seer');
  });

  it('witch-save rejected when target is not the wolf-kill target', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const target = s.players.find((p) => p.role !== 'werewolf')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: target.id });
    const other = s.players.find((p) => p.id !== target.id && p.alive)!;
    expect(() => applyAction(s, { type: 'witch-save', targetId: other.id })).toThrow(InvalidWerewolfActionError);
  });

  it('witch cannot use save+poison the same night', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const target = s.players.find((p) => p.role !== 'werewolf')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: target.id });
    s = applyAction(s, { type: 'witch-save', targetId: target.id });
    const villager = s.players.find((p) => p.role === 'villager')!;
    expect(() => applyAction(s, { type: 'witch-poison', targetId: villager.id })).toThrow(InvalidWerewolfActionError);
  });

  it('seer-divine records seerKnowledge and advances to night-resolve', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const wolfTarget = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: wolfTarget.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    expect(s.phase).toBe('night-seer');
    const seerCheck = wolves[0]!;
    s = applyAction(s, { type: 'seer-divine', targetId: seerCheck.id });
    // resolveNightAndAdvance runs synchronously: night-resolve → day-announce → day-speeches
    // (or hunter-shoot if hunter died at night, or game-over if win triggered).
    expect(['day-speeches', 'hunter-shoot', 'game-over']).toContain(s.phase);
    // pendingNight has been reset; check the appended night-action history entry instead.
    const lastNight = [...s.history].reverse().find((e) => e.type === 'night-action');
    expect(lastNight).toBeDefined();
    if (lastNight?.type === 'night-action') {
      expect(lastNight.record.seerTarget).toBe(seerCheck.id);
      expect(lastNight.record.seerResult).toBe('werewolf');
    }
  });

  it('rejects out-of-phase actions with WerewolfPhaseError', () => {
    const s = setupNight();
    expect(() => applyAction(s, { type: 'witch-skip-save' })).toThrow(WerewolfPhaseError);
  });
});
