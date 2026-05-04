import { describe, it, expect } from 'vitest';
import {
  WerewolfDecisionRequestSchema,
  WerewolfDecisionResponseSchema,
} from '../werewolf-schemas.js';

const baseRequest = {
  requestId: 'req-1',
  gameId: 'g-1',
  agentId: 'a-1',
  playerId: 'p1',
  phase: 'night-werewolf-vote',
  nightNumber: 1,
  dayNumber: 0,
  publicState: {
    gameId: 'g-1',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    players: [
      { id: 'p1', seatIndex: 0, name: '天狼', alive: true, revealedRole: null },
    ],
    history: [],
    winner: null,
  },
  privateState: {
    selfId: 'p1',
    selfRole: 'werewolf',
    selfSide: 'werewolf',
    knownAllies: [],
    seerKnowledge: [],
    witchView: null,
    hunterCanShoot: false,
  },
  validActions: [
    { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
  ],
  deadlineMs: 5000,
};

describe('WerewolfDecisionRequestSchema', () => {
  it('accepts a valid minimal request', () => {
    const r = WerewolfDecisionRequestSchema.safeParse(baseRequest);
    expect(r.success).toBe(true);
  });

  it('rejects unknown role in privateState.selfRole', () => {
    const bad = { ...baseRequest, privateState: { ...baseRequest.privateState, selfRole: 'duke' } };
    expect(WerewolfDecisionRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown phase', () => {
    const bad = { ...baseRequest, phase: 'fortify-castle' };
    expect(WerewolfDecisionRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects negative nightNumber', () => {
    const bad = { ...baseRequest, nightNumber: -1 };
    expect(WerewolfDecisionRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects deadlineMs <= 0', () => {
    const bad = { ...baseRequest, deadlineMs: 0 };
    expect(WerewolfDecisionRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('WerewolfDecisionResponseSchema', () => {
  const baseResponse = {
    requestId: 'req-1',
    agentId: 'a-1',
    action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
  };

  it('accepts a minimal valid response', () => {
    expect(WerewolfDecisionResponseSchema.safeParse(baseResponse).success).toBe(true);
  });

  it('accepts a response with bounded reasoning summary', () => {
    const r = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      reasoningSummary: {
        intent: 'Eliminate seer suspect',
        confidence: 0.7,
        keyObservations: ['p4 abstained suspiciously'],
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects reasoningSummary.intent over 200 chars', () => {
    const longIntent = 'x'.repeat(201);
    const r = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      reasoningSummary: {
        intent: longIntent,
        confidence: 0.5,
        keyObservations: [],
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects reasoningSummary with more than 10 keyObservations', () => {
    const r = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      reasoningSummary: {
        intent: 'spam',
        confidence: 0.5,
        keyObservations: Array.from({ length: 11 }, (_, i) => `obs ${i}`),
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects confidence outside [0, 1]', () => {
    const high = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      reasoningSummary: { intent: 'x', confidence: 1.1, keyObservations: [] },
    });
    expect(high.success).toBe(false);
    const low = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      reasoningSummary: { intent: 'x', confidence: -0.1, keyObservations: [] },
    });
    expect(low.success).toBe(false);
  });

  it('rejects unknown action.type', () => {
    const r = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      action: { type: 'cast-fireball', targetId: 'p2' },
    });
    expect(r.success).toBe(false);
  });
});
