import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import { getPublicState } from '../public-state.js';
import { getPrivateState } from '../private-state.js';

describe('getPublicState', () => {
  it('hides roles and role-assigned history at game start', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    const pub = getPublicState(s);
    for (const p of pub.players) {
      expect(p.revealedRole).toBeNull();
    }
    expect(pub.history.find((e) => e.type === 'role-assigned')).toBeUndefined();
  });

  it('hides night-action history entries even after a night completes', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const villager = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: villager.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    const pub = getPublicState(s);
    expect(pub.history.find((e) => e.type === 'night-action')).toBeUndefined();
    expect(pub.history.some((e) => e.type === 'death' && e.playerId === villager.id)).toBe(true);
  });

  it('strips speech.inner from public history', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const t = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: t.id });
    s = applyAction(s, { type: 'witch-save', targetId: t.id });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    const speaker = s.players.find((p) => p.alive)!;
    s = applyAction(s, { type: 'speak', playerId: speaker.id, inner: 'SECRET-INNER', performance: 'pose', speech: 'public-speech' });
    const pub = getPublicState(s);
    const speech = pub.history.find((e) => e.type === 'speech');
    expect(speech).toBeDefined();
    if (speech?.type === 'speech') {
      // The public speech entry uses Omit<SpeechRecord, 'inner'>, so inner must not be present.
      expect((speech.record as { inner?: string }).inner).toBeUndefined();
      expect(speech.record.speech).toBe('public-speech');
    }
  });

  it('reveals roles in players[].revealedRole at game-over', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    const ended = {
      ...s,
      phase: 'game-over' as const,
      winner: 'good' as const,
      players: s.players.map((p) => (p.role === 'werewolf' ? { ...p, alive: false } : p)),
    };
    const pub = getPublicState(ended);
    for (const p of pub.players) {
      expect(p.revealedRole).not.toBeNull();
    }
  });
});

describe('getPrivateState', () => {
  it('werewolf sees teammates in knownAllies', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    for (const w of wolves) {
      const priv = getPrivateState(s, w.id);
      expect(priv.selfRole).toBe('werewolf');
      expect(new Set(priv.knownAllies)).toEqual(new Set(wolves.filter((x) => x.id !== w.id).map((x) => x.id)));
    }
  });

  it('non-werewolves see empty knownAllies', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    for (const p of s.players.filter((x) => x.role !== 'werewolf')) {
      expect(getPrivateState(s, p.id).knownAllies).toEqual([]);
    }
  });

  it('seer accumulates seerKnowledge as they divine', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const villager = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: villager.id });
    s = applyAction(s, { type: 'witch-save', targetId: villager.id });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const target = wolves[0]!;
    s = applyAction(s, { type: 'seer-divine', targetId: target.id });
    const priv = getPrivateState(s, seer.id);
    expect(priv.seerKnowledge).toContainEqual({ targetId: target.id, side: 'werewolf' });
  });

  it('witch sees current night kill target only during night-witch phase', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const villager = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: villager.id });
    expect(s.phase).toBe('night-witch');
    const witch = s.players.find((p) => p.role === 'witch')!;
    const priv = getPrivateState(s, witch.id);
    expect(priv.witchView).not.toBeNull();
    expect(priv.witchView!.currentNightKillTarget).toBe(villager.id);
    expect(priv.witchView!.potions.hasSave).toBe(true);
  });

  it('non-witch sees witchView=null', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    for (const p of s.players.filter((x) => x.role !== 'witch')) {
      expect(getPrivateState(s, p.id).witchView).toBeNull();
    }
  });
});
