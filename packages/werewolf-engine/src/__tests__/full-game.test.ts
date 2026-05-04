import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import { getValidActions } from '../valid-actions.js';
import type { WerewolfAction, WerewolfGameState } from '@agent-poker/shared';

function pickFirst(actions: WerewolfAction[]): WerewolfAction | null {
  return actions[0] ?? null;
}

function alivePlayers(s: WerewolfGameState) {
  return s.players.filter((p) => p.alive);
}

describe('full-game replay', () => {
  it('plays a complete 9-AI game to game-over within 500 actions', () => {
    let s = createGame({ gameId: 'g-full', seed: 'seed-Full-1' });
    s = startFirstNight(s);
    let steps = 0;
    while (s.phase !== 'game-over' && steps < 500) {
      let progressed = false;
      for (const p of alivePlayers(s)) {
        const acts = getValidActions(s, p.id);
        if (acts.length === 0) continue;
        const action = pickFirst(acts);
        if (!action) continue;
        s = applyAction(s, action);
        progressed = true;
        steps++;
        if (s.phase === 'game-over') break;
      }
      if (!progressed) break;
    }
    expect(s.phase).toBe('game-over');
    expect(['good', 'werewolf']).toContain(s.winner);
    expect(s.history[s.history.length - 1]).toMatchObject({ type: 'game-over' });
  });

  it('full game is reproducible from the same seed', () => {
    function play(seed: string): WerewolfGameState {
      let s = createGame({ gameId: 'g-rep', seed });
      s = startFirstNight(s);
      for (let steps = 0; steps < 500 && s.phase !== 'game-over'; steps++) {
        const players = alivePlayers(s);
        let progressed = false;
        for (const p of players) {
          const acts = getValidActions(s, p.id);
          if (acts.length === 0) continue;
          s = applyAction(s, acts[0]!);
          progressed = true;
          if (s.phase === 'game-over') break;
        }
        if (!progressed) break;
      }
      return s;
    }
    const a = play('seed-Repro-1');
    const b = play('seed-Repro-1');
    expect(a.winner).toBe(b.winner);
    expect(a.history.length).toBe(b.history.length);
    expect(a.players.map((p) => ({ id: p.id, role: p.role, name: p.name, alive: p.alive }))).toEqual(
      b.players.map((p) => ({ id: p.id, role: p.role, name: p.name, alive: p.alive })),
    );
  });
});
