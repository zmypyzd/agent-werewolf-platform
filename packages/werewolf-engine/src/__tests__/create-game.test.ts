import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import {
  WEREWOLF_TOTAL_PLAYERS,
  WEREWOLF_ROLE_TO_SIDE,
  WEREWOLF_NAME_POOL,
} from '@agent-poker/shared';

describe('createGame', () => {
  it('returns a setup-phase state with 9 players, all alive', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(s.gameId).toBe('g1');
    expect(s.seed).toBe('seed-A');
    expect(s.phase).toBe('setup');
    expect(s.players.length).toBe(WEREWOLF_TOTAL_PLAYERS);
    expect(s.players.every((p) => p.alive)).toBe(true);
  });

  it('assigns canonical ids p1..p9 and seat indices 0..8', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(s.players.map((p) => p.id)).toEqual(['p1','p2','p3','p4','p5','p6','p7','p8','p9']);
    expect(s.players.map((p) => p.seatIndex)).toEqual([0,1,2,3,4,5,6,7,8]);
  });

  it('contains exactly the standard role distribution', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    const roles = s.players.map((p) => p.role).sort();
    expect(roles).toEqual([
      'hunter','seer','villager','villager','villager',
      'werewolf','werewolf','werewolf','witch',
    ]);
  });

  it('side derives correctly from role', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    for (const p of s.players) {
      expect(p.side).toBe(WEREWOLF_ROLE_TO_SIDE[p.role]);
    }
  });

  it('names come from the name pool, one each', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    const names = s.players.map((p) => p.name).sort();
    expect(names).toEqual([...WEREWOLF_NAME_POOL].sort());
  });

  it('logs role-assigned history entries (one per player) and nothing else', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(s.history.length).toBe(WEREWOLF_TOTAL_PLAYERS);
    expect(s.history.every((e) => e.type === 'role-assigned')).toBe(true);
  });

  it('initial witch potions are both available', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(s.witchPotions).toEqual({ hasSave: true, hasPoison: true });
  });

  it('same seed produces identical assignments', () => {
    const s1 = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s2 = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(s1.players).toEqual(s2.players);
    expect(s1.history).toEqual(s2.history);
  });

  it('different seeds produce different assignments', () => {
    const s1 = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s2 = createGame({ gameId: 'g1', seed: 'seed-B' });
    expect(s1.players).not.toEqual(s2.players);
  });
});
