import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { getValidActions } from '../valid-actions.js';
import type { WerewolfGameState } from '@agent-poker/shared';

function find(state: WerewolfGameState, role: 'werewolf' | 'seer' | 'witch' | 'hunter' | 'villager') {
  return state.players.filter((p) => p.role === role);
}

function withPhase(state: WerewolfGameState, phase: WerewolfGameState['phase']): WerewolfGameState {
  return { ...state, phase };
}

describe('getValidActions', () => {
  it('setup phase: no actions for any player', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    for (const p of s.players) {
      expect(getValidActions(s, p.id)).toEqual([]);
    }
  });

  it('night-werewolf-vote: only alive werewolves may vote, targeting any alive non-werewolf', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s = withPhase({ ...base, nightNumber: 1 }, 'night-werewolf-vote');
    const wolves = find(s, 'werewolf');
    const villagers = find(s, 'villager').concat(find(s, 'seer')).concat(find(s, 'witch')).concat(find(s, 'hunter'));
    expect(wolves).toHaveLength(3);
    for (const w of wolves) {
      const acts = getValidActions(s, w.id);
      expect(acts.every((a) => a.type === 'werewolf-vote' && a.voterId === w.id)).toBe(true);
      expect(new Set(acts.map((a) => (a.type === 'werewolf-vote' ? a.targetId : '')))).toEqual(
        new Set(villagers.map((v) => v.id)),
      );
    }
    for (const v of villagers) {
      expect(getValidActions(s, v.id)).toEqual([]);
    }
  });

  it('night-werewolf-vote: returns no actions for werewolves who have already cast their vote', () => {
    const base = createGame({ gameId: 'g-dup', seed: 'seed-dup' });
    const s = withPhase({ ...base, nightNumber: 1 }, 'night-werewolf-vote');
    const wolves = find(s, 'werewolf');
    const target = find(s, 'villager')[0]!;
    expect(wolves.length).toBeGreaterThan(0);
    const voter = wolves[0]!;
    const otherWolf = wolves[1];
    const afterVote: WerewolfGameState = {
      ...s,
      pendingNight: {
        ...s.pendingNight,
        werewolfVotes: { ...s.pendingNight.werewolfVotes, [voter.id]: target.id },
      },
    };
    expect(getValidActions(afterVote, voter.id)).toEqual([]);
    if (otherWolf) {
      // Other wolves who haven't voted yet still see their full action list.
      expect(getValidActions(afterVote, otherWolf.id).length).toBeGreaterThan(0);
    }
  });

  it('night-witch with both potions and a kill target: save / skip-save offered first (save decision not yet made)', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const witch = find(base, 'witch')[0]!;
    const target = base.players.find((p) => p.role !== 'witch')!;
    const s: WerewolfGameState = {
      ...base,
      phase: 'night-witch',
      nightNumber: 1,
      pendingNight: { ...base.pendingNight, witchSaveDecisionMade: false, werewolfVotes: { p1: target.id, p2: target.id, p3: target.id } },
    };
    const acts = getValidActions(s, witch.id);
    const types = acts.map((a) => a.type);
    expect(types).toContain('witch-save');
    expect(types).toContain('witch-skip-save');
    expect(types).not.toContain('witch-poison');
    expect(types).not.toContain('witch-skip-poison');
  });

  it('night-witch with both potions: poison / skip-poison offered after save decision made', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const witch = find(base, 'witch')[0]!;
    const target = base.players.find((p) => p.role !== 'witch')!;
    const s: WerewolfGameState = {
      ...base,
      phase: 'night-witch',
      nightNumber: 1,
      pendingNight: { ...base.pendingNight, witchSaveDecisionMade: true, werewolfVotes: { p1: target.id, p2: target.id, p3: target.id } },
    };
    const acts = getValidActions(s, witch.id);
    const types = acts.map((a) => a.type);
    expect(types).not.toContain('witch-save');
    expect(types).not.toContain('witch-skip-save');
    expect(types).toContain('witch-poison');
    expect(types).toContain('witch-skip-poison');
  });

  it('night-witch with no save potion: no save action', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const witch = find(base, 'witch')[0]!;
    const s: WerewolfGameState = {
      ...base,
      phase: 'night-witch',
      nightNumber: 1,
      witchPotions: { hasSave: false, hasPoison: true },
    };
    const acts = getValidActions(s, witch.id);
    expect(acts.some((a) => a.type === 'witch-save')).toBe(false);
    expect(acts.some((a) => a.type === 'witch-skip-save')).toBe(true);
  });

  it('night-seer: seer chooses any alive non-self target', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const seer = find(base, 'seer')[0]!;
    const s: WerewolfGameState = { ...base, phase: 'night-seer', nightNumber: 1 };
    const acts = getValidActions(s, seer.id);
    expect(acts.every((a) => a.type === 'seer-divine')).toBe(true);
    expect(acts.length).toBe(8);
  });

  it('day-speeches: only alive players whose seat is current speaker', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s: WerewolfGameState = { ...base, phase: 'day-speeches', dayNumber: 1 };
    for (const p of s.players) {
      const acts = getValidActions(s, p.id);
      expect(acts.every((a) => a.type === 'speak' && a.playerId === p.id)).toBe(true);
    }
  });

  it('day-vote: alive players may vote any alive non-self target or abstain (null)', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s: WerewolfGameState = { ...base, phase: 'day-vote', dayNumber: 1, pendingDayVote: { votes: [], tally: {}, banished: null, pkRound: 0, tied: false } };
    const voter = s.players[0]!;
    const acts = getValidActions(s, voter.id);
    const targets = acts.filter((a) => a.type === 'day-vote').map((a) => (a as { targetId: string | null }).targetId);
    expect(targets).toContain(null);
    expect(targets).toContain('p2');
    expect(targets).not.toContain('p1');
  });

  it('hunter-shoot: only the pending hunter may act, targeting any alive non-self or null (no shot)', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const hunter = find(base, 'hunter')[0]!;
    const s: WerewolfGameState = {
      ...base,
      phase: 'hunter-shoot',
      players: base.players.map((p) => p.id === hunter.id ? { ...p, alive: false } : p),
      pendingHunterShoot: { hunterId: hunter.id, cause: 'banishment' },
    };
    for (const p of s.players) {
      const acts = getValidActions(s, p.id);
      if (p.id === hunter.id) {
        expect(acts.length).toBeGreaterThan(0);
        expect(acts.every((a) => a.type === 'hunter-shoot')).toBe(true);
      } else {
        expect(acts).toEqual([]);
      }
    }
  });

  it('game-over: nobody acts', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s: WerewolfGameState = { ...base, phase: 'game-over', winner: 'good' };
    for (const p of s.players) {
      expect(getValidActions(s, p.id)).toEqual([]);
    }
  });
});
