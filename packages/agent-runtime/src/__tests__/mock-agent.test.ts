import { describe, it, expect } from 'vitest';
import { RandomMockAgent, AlwaysCallAgent, AlwaysFoldAgent, AggressiveAgent } from '../random-mock-agent.js';
import type { AgentDecisionRequest, LegalAction } from '@agent-poker/shared';

function makeReq(legalActions: LegalAction[]): AgentDecisionRequest {
  return {
    requestId: 'req-1',
    handId: 'hand-1',
    tableId: 'tbl-1',
    agentId: 'agent-1',
    publicState: {
      handId: 'hand-1',
      tableId: 'tbl-1',
      phase: 'preflop',
      players: [],
      communityCards: [],
      pots: [],
      button: 0,
      smallBlindIndex: 1,
      bigBlindIndex: 2,
      currentActorIndex: 0,
      currentRoundMinBet: 0,
      minRaiseAmount: 50,
      allActions: [],
    },
    privateState: {
      playerId: 'p1',
      holeCards: [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }],
    },
    legalActions,
    timeoutMs: 5000,
  };
}

describe('RandomMockAgent', () => {
  const agent = new RandomMockAgent('agent-1', 'Random');

  it('always returns actionType in legalActions (100 times)', async () => {
    const actions: LegalAction[] = [
      { type: 'check' },
      { type: 'bet', minAmount: 50, maxAmount: 1000 },
      { type: 'all-in', maxAmount: 1000 },
    ];
    for (let i = 0; i < 100; i++) {
      const res = await agent.requestDecision(makeReq(actions));
      const valid = actions.some(a => a.type === res.actionType);
      expect(valid).toBe(true);
    }
  });

  it('only fold available → returns fold', async () => {
    const res = await agent.requestDecision(makeReq([{ type: 'fold' }]));
    expect(res.actionType).toBe('fold');
  });

  it('bet available → amount in [minAmount, maxAmount]', async () => {
    const actions: LegalAction[] = [{ type: 'bet', minAmount: 100, maxAmount: 500 }];
    // Run multiple times since it's random
    for (let i = 0; i < 20; i++) {
      const res = await agent.requestDecision(makeReq(actions));
      if (res.actionType === 'bet') {
        expect(res.amount).toBeGreaterThanOrEqual(100);
        expect(res.amount).toBeLessThanOrEqual(500);
      }
    }
  });

  it('response has correct requestId and agentId', async () => {
    const req = makeReq([{ type: 'check' }]);
    const res = await agent.requestDecision(req);
    expect(res.requestId).toBe(req.requestId);
    expect(res.agentId).toBe(req.agentId);
  });
});

describe('AlwaysCallAgent', () => {
  const agent = new AlwaysCallAgent('agent-2', 'AlwaysCall');

  it('returns call when available', async () => {
    const actions: LegalAction[] = [{ type: 'fold' }, { type: 'call', callAmount: 100 }];
    const res = await agent.requestDecision(makeReq(actions));
    expect(res.actionType).toBe('call');
  });

  it('returns check when no bet', async () => {
    const res = await agent.requestDecision(makeReq([{ type: 'check' }, { type: 'bet', minAmount: 50, maxAmount: 1000 }]));
    expect(res.actionType).toBe('check');
  });
});

describe('AlwaysFoldAgent', () => {
  const agent = new AlwaysFoldAgent('agent-3', 'AlwaysFold');

  it('returns fold when available', async () => {
    const actions: LegalAction[] = [{ type: 'fold' }, { type: 'call', callAmount: 100 }];
    const res = await agent.requestDecision(makeReq(actions));
    expect(res.actionType).toBe('fold');
  });

  it('returns check when fold not available', async () => {
    const res = await agent.requestDecision(makeReq([{ type: 'check' }]));
    expect(res.actionType).toBe('check');
  });
});

describe('AggressiveAgent', () => {
  const agent = new AggressiveAgent('agent-4', 'Aggressive');

  it('goes all-in when available', async () => {
    const actions: LegalAction[] = [
      { type: 'call', callAmount: 100 },
      { type: 'all-in', maxAmount: 900 },
    ];
    const res = await agent.requestDecision(makeReq(actions));
    expect(res.actionType).toBe('all-in');
  });
});
