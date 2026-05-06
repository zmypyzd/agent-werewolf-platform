// packages/agent-runtime/src/__tests__/werewolf-npc-agent.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfAction,
  WerewolfPublicState,
  WerewolfPrivateState,
} from '@agent-poker/shared';
import { WerewolfRandomMockAgent } from '../werewolf-random-mock-agent.js';
import { WerewolfNpcAgent } from '../werewolf-npc-agent.js';

function makePublicState(nightNumber = 1): WerewolfPublicState {
  return {
    gameId: 'g',
    phase: 'day-speeches',
    nightNumber,
    dayNumber: 1,
    players: [
      { id: 'p1', seatIndex: 0, name: 'Bot 1', alive: true, revealedRole: null },
      { id: 'p2', seatIndex: 1, name: 'Bot 2', alive: true, revealedRole: null },
      { id: 'p3', seatIndex: 2, name: 'Bot 3', alive: false, revealedRole: null },
    ],
    history: [],
    winner: null,
  };
}

function makePrivateState(role: WerewolfPrivateState['selfRole'] = 'villager'): WerewolfPrivateState {
  return {
    selfId: 'p1',
    selfRole: role,
    selfSide: role === 'werewolf' ? 'werewolf' : 'good',
    knownAllies: role === 'werewolf' ? ['p4'] : [],
    seerKnowledge: role === 'seer' ? [{ targetId: 'p2', side: 'werewolf' }] : [],
    witchView: role === 'witch' ? { potions: { hasSave: true, hasPoison: true }, currentNightKillTarget: null } : null,
    hunterCanShoot: role === 'hunter',
  };
}

function makeSpeakRequest(role: WerewolfPrivateState['selfRole'] = 'villager'): WerewolfDecisionRequest {
  const validActions: WerewolfAction[] = [
    { type: 'speak', playerId: 'p1', inner: '', performance: '', speech: '' },
  ];
  return {
    requestId: 'req-1',
    gameId: 'g',
    agentId: 'agent-p1',
    playerId: 'p1',
    phase: 'day-speeches',
    nightNumber: 1,
    dayNumber: 1,
    publicState: makePublicState(),
    privateState: makePrivateState(role),
    validActions,
    deadlineMs: 10_000,
  };
}

function makeVoteRequest(): WerewolfDecisionRequest {
  return {
    requestId: 'req-2',
    gameId: 'g',
    agentId: 'agent-p1',
    playerId: 'p1',
    phase: 'day-vote',
    nightNumber: 1,
    dayNumber: 1,
    publicState: makePublicState(),
    privateState: makePrivateState('villager'),
    validActions: [
      { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
      { type: 'day-vote', voterId: 'p1', targetId: null },
    ],
    deadlineMs: 10_000,
  };
}

describe('WerewolfNpcAgent', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves only after the minimum thinking delay', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [2000, 2000],
      personality: 'balanced',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeSpeakRequest());

    let resolved = false;
    void promise.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(1999);
    await Promise.resolve(); // flush microtasks
    expect(resolved).toBe(false);  // must not have resolved yet

    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(resolved).toBe(true);
  });

  it('enriches speak action: inner, performance, speech all non-empty', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [0, 0],
      personality: 'balanced',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeSpeakRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.action.type).toBe('speak');
    if (response.action.type === 'speak') {
      expect(response.action.inner.length).toBeGreaterThan(0);
      expect(response.action.performance.length).toBeGreaterThan(0);
      expect(response.action.speech.length).toBeGreaterThan(0);
    }
  });

  it('speak inner, performance, speech all within schema length caps', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [0, 0],
      personality: 'aggressive',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeSpeakRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.action.type).toBe('speak');
    if (response.action.type === 'speak') {
      expect(response.action.inner.length).toBeLessThanOrEqual(4000);
      expect(response.action.performance.length).toBeLessThanOrEqual(500);
      expect(response.action.speech.length).toBeLessThanOrEqual(2000);
    }
  });

  it('sets reasoningSummary for speak action', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [0, 0],
      personality: 'balanced',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeSpeakRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.reasoningSummary).toBeDefined();
    expect(response.reasoningSummary!.intent.length).toBeGreaterThan(0);
    expect(response.reasoningSummary!.confidence).toBeGreaterThanOrEqual(0);
    expect(response.reasoningSummary!.confidence).toBeLessThanOrEqual(1);
    expect(response.reasoningSummary!.keyObservations.length).toBeGreaterThanOrEqual(1);
  });

  it('sets reasoningSummary for non-speak action', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [0, 0],
      personality: 'balanced',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeVoteRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.reasoningSummary).toBeDefined();
    expect(response.reasoningSummary!.intent.length).toBeGreaterThan(0);
  });

  it('seeded RNG: same seed produces identical content on two calls', async () => {
    const makeAgent = () => {
      const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'test-seed' });
      return new WerewolfNpcAgent('a', 'Bot', inner, {
        thinkingDelayRange: [0, 0],
        personality: 'balanced',
        seed: 'test-seed',
      });
    };

    const req = makeSpeakRequest('villager');

    const p1 = makeAgent().requestDecision(req);
    const p2 = makeAgent().requestDecision(req);
    await vi.runAllTimersAsync();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.action).toEqual(r2.action);
    expect(r1.reasoningSummary).toEqual(r2.reasoningSummary);
  });

  it('generates role-specific content for all 5 roles', async () => {
    const roles: WerewolfPrivateState['selfRole'][] = ['werewolf', 'seer', 'witch', 'hunter', 'villager'];
    for (const role of roles) {
      const inner = new WerewolfRandomMockAgent(`a-${role}`, 'Bot', { seed: 'seed' });
      const npc = new WerewolfNpcAgent(`a-${role}`, 'Bot', inner, {
        thinkingDelayRange: [0, 0],
        personality: 'balanced',
        seed: 'seed',
      });

      const promise = npc.requestDecision(makeSpeakRequest(role));
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.action.type, `action not speak for role=${role}`).toBe('speak');
      if (response.action.type === 'speak') {
        expect(response.action.inner.length, `inner empty for role=${role}`).toBeGreaterThan(0);
        expect(response.action.speech.length, `speech empty for role=${role}`).toBeGreaterThan(0);
      }
    }
  });

  it('does not modify a non-speak action', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [0, 0],
      personality: 'balanced',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeVoteRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    // Day-vote action should retain its type and not be mutated
    expect(response.action.type).toBe('day-vote');
  });
});
