import { describe, it, expect } from 'vitest';
import { computeLegalActions } from '../legal-actions.js';
import type { PlayerInHand } from '@agent-poker/shared';

function makePlayer(override: Partial<PlayerInHand> = {}): PlayerInHand {
  return {
    playerId: 'p1',
    seatIndex: 0,
    agentId: 'a1',
    stackBefore: 1000,
    stack: 1000,
    status: 'active',
    totalBetInHand: 0,
    currentRoundBet: 0,
    holeCards: null,
    ...override,
  };
}

const BB = 50;

describe('computeLegalActions', () => {
  it('legal-001: no bet yet → check, bet, all-in', () => {
    const player = makePlayer({ stack: 1000, currentRoundBet: 0 });
    const actions = computeLegalActions(player, { currentRoundMinBet: 0, minRaiseAmount: BB }, BB);
    const types = actions.map(a => a.type);
    expect(types).toContain('check');
    expect(types).toContain('bet');
    expect(types).toContain('all-in');
    expect(types).not.toContain('fold');
    expect(types).not.toContain('call');
  });

  it('legal-002: facing bet of 100, has 500 → fold, call, raise, all-in', () => {
    const player = makePlayer({ stack: 500, currentRoundBet: 0 });
    const actions = computeLegalActions(player, { currentRoundMinBet: 100, minRaiseAmount: 100 }, BB);
    const types = actions.map(a => a.type);
    expect(types).toContain('fold');
    expect(types).toContain('call');
    expect(types).toContain('raise');
    expect(types).toContain('all-in');
    const call = actions.find(a => a.type === 'call');
    expect(call?.callAmount).toBe(100);
  });

  it('legal-003: facing bet 100, only has 50 → fold, all-in only', () => {
    const player = makePlayer({ stack: 50, currentRoundBet: 0 });
    const actions = computeLegalActions(player, { currentRoundMinBet: 100, minRaiseAmount: 100 }, BB);
    const types = actions.map(a => a.type);
    expect(types).toContain('fold');
    expect(types).toContain('all-in');
    expect(types).not.toContain('call');
    expect(types).not.toContain('raise');
    const allin = actions.find(a => a.type === 'all-in');
    expect(allin?.maxAmount).toBe(50);
  });

  it('legal-005: folded player → empty actions', () => {
    const player = makePlayer({ status: 'folded' });
    const actions = computeLegalActions(player, { currentRoundMinBet: 0, minRaiseAmount: BB }, BB);
    expect(actions).toEqual([]);
  });

  it('legal-006: all-in player → empty actions', () => {
    const player = makePlayer({ status: 'all-in', stack: 0 });
    const actions = computeLegalActions(player, { currentRoundMinBet: 0, minRaiseAmount: BB }, BB);
    expect(actions).toEqual([]);
  });

  it('legal-007: min raise after bet of 100 → raise minAmount is 200', () => {
    const player = makePlayer({ stack: 1000, currentRoundBet: 0 });
    const actions = computeLegalActions(player, { currentRoundMinBet: 100, minRaiseAmount: 100 }, BB);
    const raise = actions.find(a => a.type === 'raise');
    expect(raise).toBeDefined();
    expect(raise!.minAmount).toBeGreaterThanOrEqual(200);
  });

  it('legal-008: preflop first to act (BB=50, no bet) → bet min=50', () => {
    const player = makePlayer({ stack: 1000, currentRoundBet: 0 });
    const actions = computeLegalActions(player, { currentRoundMinBet: 0, minRaiseAmount: BB }, BB);
    const bet = actions.find(a => a.type === 'bet');
    expect(bet).toBeDefined();
    expect(bet!.minAmount).toBe(BB);
  });

  it('legal-009: stack = call amount exactly → fold, all-in (as call) — no separate raise', () => {
    const player = makePlayer({ stack: 100, currentRoundBet: 0 });
    const actions = computeLegalActions(player, { currentRoundMinBet: 100, minRaiseAmount: 100 }, BB);
    const types = actions.map(a => a.type);
    expect(types).toContain('fold');
    expect(types).toContain('all-in');
    // Should not have raise since no chips left after call
    expect(types).not.toContain('raise');
  });

  it('legal-010: everyone checked, last to act → check, bet, all-in', () => {
    const player = makePlayer({ stack: 1000, currentRoundBet: 0 });
    const actions = computeLegalActions(player, { currentRoundMinBet: 0, minRaiseAmount: BB }, BB);
    const types = actions.map(a => a.type);
    expect(types).toContain('check');
    expect(types).toContain('bet');
    expect(types).toContain('all-in');
  });

  it('bet maxAmount equals player stack', () => {
    const player = makePlayer({ stack: 300, currentRoundBet: 0 });
    const actions = computeLegalActions(player, { currentRoundMinBet: 0, minRaiseAmount: BB }, BB);
    const bet = actions.find(a => a.type === 'bet');
    expect(bet?.maxAmount).toBe(300);
  });
});
