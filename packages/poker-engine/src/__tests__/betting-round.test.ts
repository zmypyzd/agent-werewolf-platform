import { describe, it, expect } from 'vitest';
import { applyAction, isBettingRoundComplete, getNextActiveActorIndex } from '../betting-round.js';
import type { BettingRoundState, PlayerInHand } from '@agent-poker/shared';

function makePlayer(id: string, stack: number, status: PlayerInHand['status'] = 'active', currentRoundBet = 0): PlayerInHand {
  return {
    playerId: id,
    seatIndex: 0,
    agentId: `agent-${id}`,
    stackBefore: stack + currentRoundBet,
    stack,
    status,
    totalBetInHand: currentRoundBet,
    currentRoundBet,
    holeCards: null,
  };
}

function makeRound(players: PlayerInHand[], currentActorIndex = 0, overrides: Partial<BettingRoundState> = {}): BettingRoundState {
  return {
    handId: 'hand-1',
    phase: 'preflop',
    players,
    currentActorIndex,
    currentRoundMinBet: 0,
    minRaiseAmount: 50,
    lastAggressorIndex: null,
    roundActions: [],
    ...overrides,
  };
}

describe('applyAction', () => {
  it('round-001: check — actor advances, no stack change', () => {
    const p1 = makePlayer('p1', 1000);
    const p2 = makePlayer('p2', 1000);
    const state = makeRound([p1, p2], 0);
    const next = applyAction(state, { playerId: 'p1', actionType: 'check', amount: 0 });
    expect(next.players[0]!.stack).toBe(1000);
    expect(next.roundActions).toHaveLength(1);
    expect(next.currentActorIndex).toBe(1);
  });

  it('round-002: bet 100 sets currentRoundMinBet', () => {
    const p1 = makePlayer('p1', 1000);
    const p2 = makePlayer('p2', 1000);
    const state = makeRound([p1, p2], 0);
    const next = applyAction(state, { playerId: 'p1', actionType: 'bet', amount: 100 });
    expect(next.currentRoundMinBet).toBe(100);
    expect(next.lastAggressorIndex).toBe(0);
    expect(next.players[0]!.stack).toBe(900);
  });

  it('round-003: raise updates minRaiseAmount', () => {
    const p1 = makePlayer('p1', 900, 'active', 100);
    const p2 = makePlayer('p2', 1000);
    const state = makeRound([p1, p2], 1, { currentRoundMinBet: 100, minRaiseAmount: 100, lastAggressorIndex: 0 });
    const next = applyAction(state, { playerId: 'p2', actionType: 'raise', amount: 300 });
    expect(next.currentRoundMinBet).toBe(300);
    expect(next.minRaiseAmount).toBe(200); // raised by 200 above 100
  });

  it('round-004: call reduces stack and sets currentRoundBet', () => {
    const p1 = makePlayer('p1', 1000, 'active', 0);
    const p2 = makePlayer('p2', 900, 'active', 100);
    const state = makeRound([p1, p2], 0, { currentRoundMinBet: 100, minRaiseAmount: 100 });
    const next = applyAction(state, { playerId: 'p1', actionType: 'call', amount: 100 });
    expect(next.players[0]!.stack).toBe(900);
    expect(next.players[0]!.currentRoundBet).toBe(100);
  });

  it('round-005: fold sets status to folded', () => {
    const p1 = makePlayer('p1', 1000);
    const p2 = makePlayer('p2', 1000);
    const state = makeRound([p1, p2], 0, { currentRoundMinBet: 100 });
    const next = applyAction(state, { playerId: 'p1', actionType: 'fold', amount: 0 });
    expect(next.players[0]!.status).toBe('folded');
  });

  it('round-006: all-in sets status and stack to 0', () => {
    const p1 = makePlayer('p1', 500);
    const p2 = makePlayer('p2', 1000);
    const state = makeRound([p1, p2], 0);
    const next = applyAction(state, { playerId: 'p1', actionType: 'all-in', amount: 500 });
    expect(next.players[0]!.stack).toBe(0);
    expect(next.players[0]!.status).toBe('all-in');
  });
});

describe('isBettingRoundComplete', () => {
  it('round-007: all checked → complete', () => {
    const p1 = makePlayer('p1', 1000);
    const p2 = makePlayer('p2', 1000);
    let state = makeRound([p1, p2], 0);
    state = applyAction(state, { playerId: 'p1', actionType: 'check', amount: 0 });
    state = applyAction(state, { playerId: 'p2', actionType: 'check', amount: 0 });
    expect(isBettingRoundComplete(state)).toBe(true);
  });

  it('round-008: bet then call → complete', () => {
    const p1 = makePlayer('p1', 1000);
    const p2 = makePlayer('p2', 1000);
    let state = makeRound([p1, p2], 0);
    state = applyAction(state, { playerId: 'p1', actionType: 'bet', amount: 100 });
    state = applyAction(state, { playerId: 'p2', actionType: 'call', amount: 100 });
    expect(isBettingRoundComplete(state)).toBe(true);
  });

  it('round-009: bet only, not yet called → NOT complete', () => {
    const p1 = makePlayer('p1', 1000);
    const p2 = makePlayer('p2', 1000);
    let state = makeRound([p1, p2], 0);
    state = applyAction(state, { playerId: 'p1', actionType: 'bet', amount: 100 });
    expect(isBettingRoundComplete(state)).toBe(false);
  });

  it('round-010: all-in player skipped', () => {
    const p1 = makePlayer('p1', 0, 'all-in');
    const p2 = makePlayer('p2', 1000);
    const p3 = makePlayer('p3', 1000);
    const state = makeRound([p1, p2, p3], 1);
    const next = applyAction(state, { playerId: 'p2', actionType: 'check', amount: 0 });
    // Should skip p1 (all-in) and land on p3
    expect(next.currentActorIndex).toBe(2);
  });

  it('round-011: only 1 active player → complete', () => {
    const p1 = makePlayer('p1', 1000, 'folded');
    const p2 = makePlayer('p2', 1000);
    const state = makeRound([p1, p2], 1);
    expect(isBettingRoundComplete(state)).toBe(true);
  });

  it('round-012: re-raise reopens action', () => {
    const p1 = makePlayer('p1', 1000);
    const p2 = makePlayer('p2', 1000);
    let state = makeRound([p1, p2], 0);
    // p1 bets 100
    state = applyAction(state, { playerId: 'p1', actionType: 'bet', amount: 100 });
    // p2 raises to 300
    state = applyAction(state, { playerId: 'p2', actionType: 'raise', amount: 300 });
    // Not complete yet — p1 needs to act
    expect(isBettingRoundComplete(state)).toBe(false);
  });
});
