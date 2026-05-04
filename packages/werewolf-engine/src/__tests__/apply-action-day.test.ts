import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import type { WerewolfGameState } from '@agent-poker/shared';
import { InvalidWerewolfActionError, WerewolfPhaseError } from '@agent-poker/shared';

function rushToDaySpeeches(seed = 'seed-A'): WerewolfGameState {
  let s = createGame({ gameId: 'g1', seed });
  s = startFirstNight(s);
  const wolves = s.players.filter((p) => p.role === 'werewolf');
  const villager = s.players.find((p) => p.role === 'villager')!;
  for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: villager.id });
  s = applyAction(s, { type: 'witch-save', targetId: villager.id });
  s = applyAction(s, { type: 'witch-skip-poison' });
  const seer = s.players.find((p) => p.role === 'seer')!;
  const someoneElse = s.players.find((p) => p.id !== seer.id)!;
  s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
  expect(s.phase).toBe('day-speeches');
  return s;
}

describe('applyAction — day phase', () => {
  it('speak appends to pendingDaySpeeches but stays in day-speeches until all alive players spoke once', () => {
    let s = rushToDaySpeeches();
    const aliveOrder = s.players.filter((p) => p.alive).map((p) => p.id);
    for (let i = 0; i < aliveOrder.length - 1; i++) {
      s = applyAction(s, { type: 'speak', playerId: aliveOrder[i]!, inner: 'i', performance: 'p', speech: 's' });
      expect(s.phase).toBe('day-speeches');
    }
    s = applyAction(s, { type: 'speak', playerId: aliveOrder[aliveOrder.length - 1]!, inner: 'i', performance: 'p', speech: 's' });
    expect(s.phase).toBe('day-vote');
    expect(s.pendingDayVote).not.toBeNull();
  });

  it('speak rejects a player who already spoke this round', () => {
    let s = rushToDaySpeeches();
    const first = s.players.find((p) => p.alive)!;
    s = applyAction(s, { type: 'speak', playerId: first.id, inner: 'i', performance: 'p', speech: 's' });
    expect(() => applyAction(s, { type: 'speak', playerId: first.id, inner: 'i', performance: 'p', speech: 's' })).toThrow(InvalidWerewolfActionError);
  });

  it('day-vote with majority banishes; transitions through day-resolve to either next night or game-over', () => {
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    const target = s.players.find((p) => p.role === 'villager')!;
    const voters = s.players.filter((p) => p.alive && p.id !== target.id);
    for (const v of voters) {
      s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: target.id });
    }
    s = applyAction(s, { type: 'day-vote', voterId: target.id, targetId: null });
    expect(['night-werewolf-vote', 'game-over', 'hunter-shoot']).toContain(s.phase);
    expect(s.players.find((p) => p.id === target.id)!.alive).toBe(false);
  });

  it('day-vote tie triggers a PK round (still in day-vote, pkRound increments)', () => {
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    const a = s.players[0]!;
    const b = s.players[1]!;
    const others = s.players.filter((p) => p.id !== a.id && p.id !== b.id && p.alive);
    others.slice(0, Math.floor(others.length / 2)).forEach((v) => {
      s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: a.id });
    });
    others.slice(Math.floor(others.length / 2)).forEach((v) => {
      s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: b.id });
    });
    s = applyAction(s, { type: 'day-vote', voterId: a.id, targetId: null });
    s = applyAction(s, { type: 'day-vote', voterId: b.id, targetId: null });
    expect(s.phase).toBe('day-vote');
    expect(s.pendingDayVote!.pkRound).toBe(1);
    expect(s.pendingDayVote!.tied).toBe(true);
  });

  it('hunter-shoot fires when banished hunter shoots a target', () => {
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    const voters = s.players.filter((p) => p.alive && p.id !== hunter.id);
    for (const v of voters) s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: hunter.id });
    s = applyAction(s, { type: 'day-vote', voterId: hunter.id, targetId: null });
    expect(s.phase).toBe('hunter-shoot');
    expect(s.pendingHunterShoot!.hunterId).toBe(hunter.id);
    const wolf = s.players.find((p) => p.role === 'werewolf' && p.alive)!;
    s = applyAction(s, { type: 'hunter-shoot', targetId: wolf.id });
    expect(s.players.find((p) => p.id === wolf.id)!.alive).toBe(false);
    expect(s.pendingHunterShoot).toBeNull();
  });

  it('rejects out-of-phase day actions', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-A' });
    s = startFirstNight(s);
    expect(() => applyAction(s, { type: 'day-vote', voterId: 'p1', targetId: 'p2' })).toThrow(WerewolfPhaseError);
  });
});
