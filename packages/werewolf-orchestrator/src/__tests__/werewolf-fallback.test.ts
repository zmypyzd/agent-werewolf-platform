import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfAction,
  WerewolfPublicState,
  WerewolfPrivateState,
} from '@agent-poker/shared';
import { werewolfFallback } from '../werewolf-fallback.js';

function fakeRequest(validActions: WerewolfAction[]): WerewolfDecisionRequest {
  const publicState: WerewolfPublicState = {
    gameId: 'g',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    players: [],
    history: [],
    winner: null,
  };
  const privateState: WerewolfPrivateState = {
    selfId: 'p1',
    selfRole: 'werewolf',
    selfSide: 'werewolf',
    knownAllies: [],
    seerKnowledge: [],
    witchView: null,
    hunterCanShoot: false,
  };
  return {
    requestId: 'req-1',
    gameId: 'g',
    agentId: 'a-1',
    playerId: 'p1',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    publicState,
    privateState,
    validActions,
    deadlineMs: 5000,
  };
}

describe('werewolfFallback', () => {
  it('returns the first valid action wrapped in a response', () => {
    const action: WerewolfAction = { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' };
    const res = werewolfFallback(fakeRequest([action, { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' }]));
    expect(res.action).toEqual(action);
    expect(res.requestId).toBe('req-1');
    expect(res.agentId).toBe('a-1');
  });

  it('throws if validActions is empty (caller should never invoke fallback in that case)', () => {
    expect(() => werewolfFallback(fakeRequest([]))).toThrow(/no valid action/);
  });
});
