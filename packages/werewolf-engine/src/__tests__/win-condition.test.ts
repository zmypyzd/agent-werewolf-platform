import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { checkWinCondition } from '../win-condition.js';
import type { WerewolfGameState } from '@agent-poker/shared';

function killAllWerewolves(s: WerewolfGameState): WerewolfGameState {
  return { ...s, players: s.players.map((p) => (p.role === 'werewolf' ? { ...p, alive: false } : p)) };
}

function killAllVillagers(s: WerewolfGameState): WerewolfGameState {
  return { ...s, players: s.players.map((p) => (p.role === 'villager' ? { ...p, alive: false } : p)) };
}

function killAllGods(s: WerewolfGameState): WerewolfGameState {
  return {
    ...s,
    players: s.players.map((p) => (p.role === 'seer' || p.role === 'witch' || p.role === 'hunter' ? { ...p, alive: false } : p)),
  };
}

function killWolvesUntilEqualGood(s: WerewolfGameState): WerewolfGameState {
  let killed = 0;
  return {
    ...s,
    players: s.players.map((p) => {
      if (killed >= 3 || p.role === 'werewolf') return p;
      killed++;
      return { ...p, alive: false };
    }),
  };
}

describe('checkWinCondition', () => {
  it('returns null at start of game', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(checkWinCondition(s)).toBeNull();
  });

  it('returns "good" when all werewolves are dead', () => {
    const s = killAllWerewolves(createGame({ gameId: 'g1', seed: 'seed-A' }));
    expect(checkWinCondition(s)).toBe('good');
  });

  it('returns "werewolf" when all villagers are dead', () => {
    const s = killAllVillagers(createGame({ gameId: 'g1', seed: 'seed-A' }));
    expect(checkWinCondition(s)).toBe('werewolf');
  });

  it('returns "werewolf" when all gods (seer+witch+hunter) are dead', () => {
    const s = killAllGods(createGame({ gameId: 'g1', seed: 'seed-A' }));
    expect(checkWinCondition(s)).toBe('werewolf');
  });

  it('returns "werewolf" when wolves >= good (wolf parity)', () => {
    const s = killWolvesUntilEqualGood(createGame({ gameId: 'g1', seed: 'seed-A' }));
    expect(checkWinCondition(s)).toBe('werewolf');
  });
});
