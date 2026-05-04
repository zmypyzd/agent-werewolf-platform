import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfAction,
  WerewolfPublicState,
  WerewolfPrivateState,
} from '@agent-poker/shared';
import { WerewolfMockAgent } from '../werewolf-mock-agent.js';

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
    requestId: 'req',
    gameId: 'g',
    agentId: 'a',
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

describe('WerewolfMockAgent', () => {
  it('returns the first valid action', async () => {
    const agent = new WerewolfMockAgent('a1', 'Mock');
    const action: WerewolfAction = { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' };
    const res = await agent.requestDecision(fakeRequest([action, { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' }]));
    expect(res.action).toEqual(action);
    expect(res.requestId).toBe('req');
    expect(res.agentId).toBe('a1');
  });

  it('throws if validActions is empty', async () => {
    const agent = new WerewolfMockAgent('a1', 'Mock');
    await expect(agent.requestDecision(fakeRequest([]))).rejects.toThrow(/no valid action/);
  });

  it('exposes id and name', () => {
    const agent = new WerewolfMockAgent('a-7', 'Cassandra');
    expect(agent.agentId).toBe('a-7');
    expect(agent.name).toBe('Cassandra');
  });
});
