import { describe, it, expect } from 'vitest';
import type {
  WerewolfPublicState,
  WerewolfPrivateState,
  WerewolfAction,
} from '@agent-poker/shared';
import { buildDefaultWerewolfBriefing } from '@agent-poker/shared';
import { WerewolfDecisionRequestSchema } from '@agent-poker/agent-protocol';
import { buildWerewolfDecisionRequest } from '../werewolf-decision-request.js';

const publicState: WerewolfPublicState = {
  gameId: 'g-1',
  phase: 'night-werewolf-vote',
  nightNumber: 1,
  dayNumber: 0,
  players: [
    { id: 'p1', seatIndex: 0, name: '天狼', alive: true, revealedRole: null },
    { id: 'p2', seatIndex: 1, name: '星辰', alive: true, revealedRole: null },
    { id: 'p3', seatIndex: 2, name: '明月', alive: true, revealedRole: null },
    { id: 'p4', seatIndex: 3, name: '清风', alive: true, revealedRole: null },
  ],
  history: [],
  winner: null,
};

const privateState: WerewolfPrivateState = {
  selfId: 'p1',
  selfRole: 'werewolf',
  selfSide: 'werewolf',
  knownAllies: ['p2', 'p3'],
  seerKnowledge: [],
  witchView: null,
  hunterCanShoot: false,
};

const validActions: WerewolfAction[] = [
  { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
];

describe('buildWerewolfDecisionRequest', () => {
  it('builds a request payload that conforms to the Zod schema', () => {
    const req = buildWerewolfDecisionRequest({
      requestId: 'req-1',
      gameId: 'g-1',
      agentId: 'a-1',
      playerId: 'p1',
      publicState,
      privateState,
      validActions,
      deadlineMs: 5000,
    });
    expect(WerewolfDecisionRequestSchema.safeParse(req).success).toBe(true);
  });

  it('echoes phase / night / day from publicState', () => {
    const req = buildWerewolfDecisionRequest({
      requestId: 'req-1',
      gameId: 'g-1',
      agentId: 'a-1',
      playerId: 'p1',
      publicState,
      privateState,
      validActions,
      deadlineMs: 5000,
    });
    expect(req.phase).toBe('night-werewolf-vote');
    expect(req.nightNumber).toBe(1);
    expect(req.dayNumber).toBe(0);
  });

  it('throws if privateState.selfId !== playerId', () => {
    expect(() =>
      buildWerewolfDecisionRequest({
        requestId: 'req-1',
        gameId: 'g-1',
        agentId: 'a-1',
        playerId: 'p1',
        publicState,
        privateState: { ...privateState, selfId: 'p9' },
        validActions,
        deadlineMs: 5000,
      }),
    ).toThrow(/playerId mismatch/);
  });

  it('omits the briefing field when none is provided', () => {
    const req = buildWerewolfDecisionRequest({
      requestId: 'req-1',
      gameId: 'g-1',
      agentId: 'a-1',
      playerId: 'p1',
      publicState,
      privateState,
      validActions,
      deadlineMs: 5000,
    });
    expect(req).not.toHaveProperty('briefing');
  });

  it('passes briefing through to the request when provided', () => {
    const briefing = buildDefaultWerewolfBriefing({
      docsUrl: 'https://example.com/guide',
    });
    const req = buildWerewolfDecisionRequest({
      requestId: 'req-1',
      gameId: 'g-1',
      agentId: 'a-1',
      playerId: 'p1',
      publicState,
      privateState,
      validActions,
      deadlineMs: 5000,
      briefing,
    });
    expect(req.briefing).toEqual(briefing);
    expect(WerewolfDecisionRequestSchema.safeParse(req).success).toBe(true);
  });

  it('throws if publicState.gameId !== gameId', () => {
    expect(() =>
      buildWerewolfDecisionRequest({
        requestId: 'req-1',
        gameId: 'g-2',
        agentId: 'a-1',
        playerId: 'p1',
        publicState,
        privateState,
        validActions,
        deadlineMs: 5000,
      }),
    ).toThrow(/gameId mismatch/);
  });
});
