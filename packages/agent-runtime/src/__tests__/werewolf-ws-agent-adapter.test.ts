import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
} from '@agent-poker/shared';
import { NotImplementedError } from '@agent-poker/shared';
import { WerewolfWsAgentAdapter } from '../werewolf-ws-agent-adapter.js';

const stubReq: WerewolfDecisionRequest = {
  requestId: 'r', gameId: 'g', agentId: 'a', playerId: 'p1',
  phase: 'night-werewolf-vote', nightNumber: 1, dayNumber: 0,
  publicState: {
    gameId: 'g', phase: 'night-werewolf-vote', nightNumber: 1, dayNumber: 0,
    players: [], history: [], winner: null,
  },
  privateState: {
    selfId: 'p1', selfRole: 'werewolf', selfSide: 'werewolf',
    knownAllies: [], seerKnowledge: [], witchView: null, hunterCanShoot: false,
  },
  validActions: [{ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' }],
  deadlineMs: 1000,
};

describe('WerewolfWsAgentAdapter', () => {
  it('stores its identity and endpoint without invoking the network', () => {
    const a = new WerewolfWsAgentAdapter('a-1', 'Wolf', 'ws://example/ws');
    expect(a.agentId).toBe('a-1');
    expect(a.name).toBe('Wolf');
    expect(a.endpoint).toBe('ws://example/ws');
  });

  it('requestDecision throws NotImplementedError', async () => {
    const a = new WerewolfWsAgentAdapter('a-1', 'Wolf', 'ws://example/ws');
    await expect(a.requestDecision(stubReq)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
