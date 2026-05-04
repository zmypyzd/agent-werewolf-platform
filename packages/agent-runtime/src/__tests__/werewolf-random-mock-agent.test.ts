import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfAction,
  WerewolfPublicState,
  WerewolfPrivateState,
} from '@agent-poker/shared';
import { WerewolfRandomMockAgent } from '../werewolf-random-mock-agent.js';

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

const actions: WerewolfAction[] = [
  { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
  { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' },
  { type: 'werewolf-vote', voterId: 'p1', targetId: 'p6' },
];

describe('WerewolfRandomMockAgent', () => {
  it('returns one of the valid actions', async () => {
    const agent = new WerewolfRandomMockAgent('a1', 'Random');
    const res = await agent.requestDecision(fakeRequest(actions));
    expect(actions).toContainEqual(res.action);
  });

  it('seeded constructor: same seed produces same sequence of picks', async () => {
    const a1 = new WerewolfRandomMockAgent('a1', 'A', { seed: 'test-seed' });
    const a2 = new WerewolfRandomMockAgent('a1', 'A', { seed: 'test-seed' });
    const r1 = await a1.requestDecision(fakeRequest(actions));
    const r2 = await a2.requestDecision(fakeRequest(actions));
    expect(r1.action).toEqual(r2.action);
  });

  it('seeded constructor: different seeds typically pick differently', async () => {
    // Use 8 distinct seeds and assert at least 2 distinct picks. With 3 valid
    // actions and a uniform RNG, the probability of all 8 picking the same
    // is < (1/3)^7 ≈ 0.05%, so this is robust.
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
    const picks = new Set<string>();
    for (const s of seeds) {
      const a = new WerewolfRandomMockAgent('a1', 'A', { seed: s });
      const r = await a.requestDecision(fakeRequest(actions));
      picks.add(JSON.stringify(r.action));
    }
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });

  it('throws if validActions is empty', async () => {
    const agent = new WerewolfRandomMockAgent('a1', 'A');
    await expect(agent.requestDecision(fakeRequest([]))).rejects.toThrow(/no valid action/);
  });
});
