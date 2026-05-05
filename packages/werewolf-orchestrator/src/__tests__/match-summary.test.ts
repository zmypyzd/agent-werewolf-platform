import { describe, it, expect } from 'vitest';
import type { WerewolfGameState } from '@agent-poker/shared';
import { createGame } from '@agent-poker/werewolf-engine';
import { buildWerewolfMatchSummary } from '../match-summary.js';

function gameOverState(seed: string): WerewolfGameState {
  const base = createGame({ gameId: 'g-test', seed });
  return {
    ...base,
    phase: 'game-over',
    winner: 'good',
    nightNumber: 2,
    dayNumber: 2,
    history: [
      ...base.history,
      { type: 'game-over', winner: 'good' },
    ],
  };
}

describe('buildWerewolfMatchSummary', () => {
  it('builds a summary with winner, durations, and final players', () => {
    const initial = createGame({ gameId: 'g-test', seed: 's-summary-1' });
    const final = gameOverState('s-summary-1');
    const summary = buildWerewolfMatchSummary({
      initialState: initial,
      finalState: final,
      startedAt: 1_000,
      completedAt: 1_750,
      replayEventCount: 42,
      stepCount: 18,
    });

    expect(summary.gameId).toBe('g-test');
    expect(summary.seed).toBe('s-summary-1');
    expect(summary.winner).toBe('good');
    expect(summary.startedAt).toBe(1_000);
    expect(summary.completedAt).toBe(1_750);
    expect(summary.durationMs).toBe(750);
    expect(summary.nightCount).toBe(2);
    expect(summary.dayCount).toBe(2);
    expect(summary.finalPlayers).toHaveLength(9);
    for (const p of summary.finalPlayers) {
      expect(['werewolf', 'villager', 'seer', 'witch', 'hunter']).toContain(p.role);
      expect(['werewolf', 'good']).toContain(p.side);
    }
    expect(summary.history).toEqual(final.history);
    expect(summary.replayEventCount).toBe(42);
    expect(summary.stepCount).toBe(18);
  });

  it('throws when finalState.winner is null (not at game-over)', () => {
    const initial = createGame({ gameId: 'g-test', seed: 's-summary-2' });
    expect(() =>
      buildWerewolfMatchSummary({
        initialState: initial,
        finalState: initial, // setup phase, no winner
        startedAt: 0,
        completedAt: 0,
        replayEventCount: 0,
        stepCount: 0,
      }),
    ).toThrow(/winner/);
  });
});
