import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import { InvalidWerewolfActionError } from '@agent-poker/shared';

describe('hunter-shoot edge cases', () => {
  it('hunter killed at night by wolves triggers hunter-shoot before day-speeches', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-Hunter-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: hunter.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    expect(s.phase).toBe('hunter-shoot');
    expect(s.pendingHunterShoot!.cause).toBe('wolf-kill');
  });

  it('hunter poisoned by witch does NOT trigger hunter-shoot (v1 house rule)', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-Hunter-B' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    const villager = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: villager.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-poison', targetId: hunter.id });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    expect(s.players.find((p) => p.id === hunter.id)!.alive).toBe(false);
    expect(s.phase).not.toBe('hunter-shoot');
  });

  it('hunter-shoot rejects shooting self', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-Hunter-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: hunter.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    expect(s.phase).toBe('hunter-shoot');
    expect(() => applyAction(s, { type: 'hunter-shoot', targetId: hunter.id })).toThrow(InvalidWerewolfActionError);
  });

  it('hunter may decline to shoot (targetId=null)', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-Hunter-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: hunter.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    expect(s.phase).toBe('hunter-shoot');
    s = applyAction(s, { type: 'hunter-shoot', targetId: null });
    expect(s.phase).not.toBe('hunter-shoot');
    expect(s.pendingHunterShoot).toBeNull();
  });

  it('getValidActions returns hunter-shoot options for the dead hunter in hunter-shoot phase', async () => {
    const { getValidActions } = await import('../valid-actions.js');
    let s = createGame({ gameId: 'g1', seed: 'seed-Hunter-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: hunter.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    expect(s.phase).toBe('hunter-shoot');
    expect(s.players.find((p) => p.id === hunter.id)!.alive).toBe(false);
    const acts = getValidActions(s, hunter.id);
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.every((a) => a.type === 'hunter-shoot')).toBe(true);
  });
});
