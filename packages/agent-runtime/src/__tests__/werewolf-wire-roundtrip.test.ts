// packages/agent-runtime/src/__tests__/werewolf-wire-roundtrip.test.ts
import { describe, expect, it } from 'vitest';
import {
  WerewolfDecisionRequestSchema,
  WerewolfDecisionResponseSchema,
  WEREWOLF_SPEAK_INNER_MAX,
  WEREWOLF_SPEAK_PERFORMANCE_MAX,
  WEREWOLF_SPEAK_SPEECH_MAX,
} from '@agent-poker/agent-protocol';
import { buildWerewolfDecisionRequest } from '../werewolf-decision-request.js';

describe('Werewolf wire-format JSON round trip', () => {
  it('serializes and re-parses a complete request', () => {
    const req = buildWerewolfDecisionRequest({
      requestId: 'r-1',
      gameId: 'g-1',
      agentId: 'a-1',
      playerId: 'p1',
      publicState: {
        gameId: 'g-1', phase: 'day-vote', nightNumber: 1, dayNumber: 1,
        players: [
          { id: 'p1', seatIndex: 0, name: 'A', alive: true, revealedRole: null },
        ],
        history: [], winner: null,
      },
      privateState: {
        selfId: 'p1', selfRole: 'villager', selfSide: 'good',
        knownAllies: [], seerKnowledge: [], witchView: null, hunterCanShoot: false,
      },
      validActions: [
        { type: 'day-vote', voterId: 'p1', targetId: null },
        { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
      ],
      deadlineMs: 5_000,
    });
    const json = JSON.stringify(req);
    const parsed = WerewolfDecisionRequestSchema.parse(JSON.parse(json));
    expect(parsed.requestId).toBe('r-1');
    expect(parsed.validActions.length).toBe(2);
  });

  it('rejects speak with inner over WEREWOLF_SPEAK_INNER_MAX', () => {
    const oversize = {
      requestId: 'r', agentId: 'a',
      action: {
        type: 'speak', playerId: 'p1',
        inner: 'X'.repeat(WEREWOLF_SPEAK_INNER_MAX + 1),
        performance: 'ok', speech: 'ok',
      },
    };
    const result = WerewolfDecisionResponseSchema.safeParse(oversize);
    expect(result.success).toBe(false);
  });

  it('accepts speak at exactly the inner cap', () => {
    const ok = {
      requestId: 'r', agentId: 'a',
      action: {
        type: 'speak', playerId: 'p1',
        inner: 'X'.repeat(WEREWOLF_SPEAK_INNER_MAX),
        performance: 'X'.repeat(WEREWOLF_SPEAK_PERFORMANCE_MAX),
        speech: 'X'.repeat(WEREWOLF_SPEAK_SPEECH_MAX),
      },
    };
    expect(WerewolfDecisionResponseSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects unknown action.type', () => {
    const result = WerewolfDecisionResponseSchema.safeParse({
      requestId: 'r', agentId: 'a',
      action: { type: 'invent-a-move', targetId: 'p2' },
    });
    expect(result.success).toBe(false);
  });

  it('round-trips every action variant', () => {
    const variants = [
      { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
      { type: 'witch-save', targetId: 'p1' },
      { type: 'witch-skip-save' },
      { type: 'witch-poison', targetId: 'p3' },
      { type: 'witch-skip-poison' },
      { type: 'seer-divine', targetId: 'p4' },
      { type: 'speak', playerId: 'p1', inner: 'i', performance: 'p', speech: 's' },
      { type: 'day-vote', voterId: 'p1', targetId: null },
      { type: 'day-vote', voterId: 'p1', targetId: 'p5' },
      { type: 'hunter-shoot', targetId: null },
      { type: 'hunter-shoot', targetId: 'p6' },
    ];
    for (const action of variants) {
      const wire = JSON.parse(JSON.stringify({ requestId: 'r', agentId: 'a', action }));
      expect(WerewolfDecisionResponseSchema.safeParse(wire).success).toBe(true);
    }
  });
});
