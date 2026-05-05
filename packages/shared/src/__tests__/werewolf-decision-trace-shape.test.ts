import { describe, expect, it } from 'vitest';
import type {
  WerewolfDecisionTrace,
  WerewolfDecisionTraceFallbackReason,
} from '../werewolf-decision-trace.js';

describe('WerewolfDecisionTrace', () => {
  it('compiles a complete sample trace', () => {
    const trace: WerewolfDecisionTrace = {
      traceId: 't-1',
      matchId: 'g-1',
      sequence: 5,
      requestId: 'r-1',
      agentId: 'agent-1',
      playerId: 'p1',
      phase: 'night-werewolf-vote',
      nightNumber: 1,
      dayNumber: 0,
      publicStateHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      privateStateHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      validActionTypes: ['werewolf-vote'],
      responseAction: { type: 'werewolf-vote' },
      appliedAction: { type: 'werewolf-vote' },
      latencyMs: 42,
      timedOut: false,
      invalidReason: null,
      fallbackReason: null,
      reasoningSummary: {
        intent: 'eliminate seer',
        confidence: 0.7,
        keyObservations: ['p3 acted suspiciously'],
      },
      createdAt: 1_700_000_000_000,
    };
    expect(trace.phase).toBe('night-werewolf-vote');
  });

  it('fallbackReason union covers timeout/invalid_action/missing_agent', () => {
    const reasons: WerewolfDecisionTraceFallbackReason[] = [
      'timeout',
      'invalid_action',
      'missing_agent',
    ];
    expect(reasons).toHaveLength(3);
  });
});
