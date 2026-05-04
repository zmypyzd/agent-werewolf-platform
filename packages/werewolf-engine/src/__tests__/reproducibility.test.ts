import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import { getValidActions } from '../valid-actions.js';
import type { WerewolfGameState } from '@agent-poker/shared';

function play(seed: string): WerewolfGameState {
  let s = createGame({ gameId: 'g', seed });
  s = startFirstNight(s);
  for (let i = 0; i < 500 && s.phase !== 'game-over'; i++) {
    let progressed = false;
    for (const p of s.players.filter((x) => x.alive)) {
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

describe('seed sweep', () => {
  const seeds = ['s-1','s-2','s-3','s-4','s-5','s-6','s-7','s-8'];
  it.each(seeds)('seed %s is byte-identical across runs', (seed) => {
    const a = play(seed);
    const b = play(seed);
    expect(a).toEqual(b);
  });

  it('different seeds produce at least 3 distinct outcomes (history.length variance)', () => {
    const lengths = new Set(seeds.map((s) => play(s).history.length));
    expect(lengths.size).toBeGreaterThanOrEqual(3);
  });
});
