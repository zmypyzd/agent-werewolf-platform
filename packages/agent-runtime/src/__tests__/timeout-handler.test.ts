import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimeoutHandler } from '../timeout-handler.js';
import type { IAgent } from '../agent-interface.js';
import type { AgentDecisionRequest, AgentDecisionResponse, LegalAction } from '@agent-poker/shared';

function makeReq(legalActions: LegalAction[]): AgentDecisionRequest {
  return {
    requestId: 'req-1',
    handId: 'hand-1',
    tableId: 'tbl-1',
    agentId: 'agent-1',
    publicState: {
      handId: 'hand-1', tableId: 'tbl-1', phase: 'preflop',
      players: [], communityCards: [], pots: [],
      button: 0, smallBlindIndex: 1, bigBlindIndex: 2,
      currentActorIndex: 0, currentRoundMinBet: 0, minRaiseAmount: 50, allActions: [],
    },
    privateState: { playerId: 'p1', holeCards: [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }] },
    legalActions,
    timeoutMs: 5000,
  };
}

function makeAgent(delayMs: number, response?: Partial<AgentDecisionResponse>): IAgent {
  return {
    agentId: 'agent-1',
    name: 'Test',
    requestDecision: async (req) => {
      await new Promise(r => setTimeout(r, delayMs));
      return {
        requestId: req.requestId,
        agentId: req.agentId,
        actionType: 'check',
        ...response,
      };
    },
  };
}

describe('TimeoutHandler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('agent resolves before timeout → timedOut: false', async () => {
    const agent = makeAgent(100);
    const handler = new TimeoutHandler(agent, 5000);
    const req = makeReq([{ type: 'check' }]);

    const promise = handler.requestDecision(req);
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result.timedOut).toBe(false);
    expect(result.response.actionType).toBe('check');
  });

  it('agent delays beyond timeout → timedOut: true, fallback returned', async () => {
    const agent = makeAgent(10000);
    const handler = new TimeoutHandler(agent, 5000);
    const req = makeReq([{ type: 'check' }, { type: 'bet', minAmount: 50, maxAmount: 1000 }]);

    const promise = handler.requestDecision(req);
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;

    expect(result.timedOut).toBe(true);
  });

  it('fallback is check when check is in legalActions', async () => {
    const agent = makeAgent(10000);
    const handler = new TimeoutHandler(agent, 1000);
    const req = makeReq([{ type: 'fold' }, { type: 'check' }]);

    const promise = handler.requestDecision(req);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result.timedOut).toBe(true);
    expect(result.response.actionType).toBe('check');
  });

  it('fallback is fold when check not in legalActions', async () => {
    const agent = makeAgent(10000);
    const handler = new TimeoutHandler(agent, 1000);
    const req = makeReq([{ type: 'fold' }, { type: 'call', callAmount: 100 }]);

    const promise = handler.requestDecision(req);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result.timedOut).toBe(true);
    expect(result.response.actionType).toBe('fold');
  });

  it('timed-out response has correct requestId', async () => {
    const agent = makeAgent(10000);
    const handler = new TimeoutHandler(agent, 1000);
    const req = makeReq([{ type: 'fold' }]);

    const promise = handler.requestDecision(req);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result.response.requestId).toBe(req.requestId);
  });
});
