import { describe, expect, it } from 'vitest';
import {
  AgentDecisionResponseSchema,
  DecisionTraceSchema,
  ReasoningSummarySchema,
} from '../schemas.js';

const now = 1_777_280_000_000;

const reasoningSummary = {
  intent: 'value',
  confidence: 0.72,
  riskLevel: 'medium',
  keyObservations: [
    'Top pair blocks many weaker calls',
    'Button range still contains missed draws',
  ],
  consideredActions: [
    { actionType: 'check', reason: 'Keeps pot small out of position' },
    { actionType: 'bet', amount: 150, reason: 'Targets second-pair calls' },
  ],
};

function makeDecisionTrace() {
  return {
    traceId: 'trace-001',
    matchId: 'match-001',
    handId: 'hand-001',
    actionId: 'action-001',
    requestId: 'request-001',
    agentId: 'agent-001',
    playerId: 'player-001',
    phase: 'flop',
    publicStateHash: 'a'.repeat(64),
    privateStateHash: 'b'.repeat(64),
    legalActions: [
      { type: 'check' },
      { type: 'bet', minAmount: 100, maxAmount: 500 },
    ],
    responseAction: {
      actionType: 'bet',
      amount: 150,
    },
    appliedAction: {
      actionType: 'bet',
      amount: 150,
    },
    latencyMs: 42,
    timedOut: false,
    invalidReason: null,
    reasoningSummary,
    createdAt: now,
  };
}

describe('decision trace schemas', () => {
  it('accepts a bounded structured reasoning summary', () => {
    const parsed = ReasoningSummarySchema.parse(reasoningSummary);

    expect(parsed.intent).toBe('value');
    expect(parsed.consideredActions).toHaveLength(2);
  });

  it('allows agent decisions to include a public reasoning summary', () => {
    const parsed = AgentDecisionResponseSchema.parse({
      requestId: 'request-001',
      agentId: 'agent-001',
      actionType: 'bet',
      amount: 150,
      reasoningSummary,
    });

    expect(parsed.reasoningSummary?.riskLevel).toBe('medium');
  });

  it('accepts a public-safe decision trace linked to request and action ids', () => {
    const parsed = DecisionTraceSchema.parse(makeDecisionTrace());

    expect(parsed.requestId).toBe('request-001');
    expect(parsed.actionId).toBe('action-001');
    expect(parsed.reasoningSummary?.intent).toBe('value');
  });

  it('rejects raw chain-of-thought fields at reasoning and trace boundaries', () => {
    expect(() => ReasoningSummarySchema.parse({
      ...reasoningSummary,
      rawChainOfThought: 'hidden private reasoning',
    })).toThrow();

    expect(() => DecisionTraceSchema.parse({
      ...makeDecisionTrace(),
      rawChainOfThought: 'hidden private reasoning',
    })).toThrow();
  });

  it('rejects unbounded reasoning summaries', () => {
    expect(() => ReasoningSummarySchema.parse({
      ...reasoningSummary,
      keyObservations: Array.from({ length: 6 }, (_, index) => `Observation ${index}`),
    })).toThrow();

    expect(() => ReasoningSummarySchema.parse({
      ...reasoningSummary,
      consideredActions: Array.from({ length: 7 }, (_, index) => ({
        actionType: 'check',
        reason: `Option ${index}`,
      })),
    })).toThrow();
  });
});
