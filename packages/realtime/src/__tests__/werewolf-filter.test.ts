import { describe, expect, it } from 'vitest';
import { werewolfReplayEventToPublic } from '../werewolf-filter.js';
import type { WerewolfReplayEvent } from '@agent-poker/shared';

const baseEvent = {
  eventId: 'evt-1',
  gameId: 'g-1',
  sequence: 0,
  timestamp: 1_000,
};

describe('werewolfReplayEventToPublic — werewolf', () => {
  it('strips seed from match.started but preserves gameId + players', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'match.started',
      data: {
        gameId: 'g-1',
        seed: 'seed-1',
        players: [{ id: 'p1', seatIndex: 0, name: 'Alice' }],
      },
    };
    const out = werewolfReplayEventToPublic(e)!;
    expect(out.data['seed']).toBeUndefined();
    expect(out.data['gameId']).toBe('g-1');
    expect(out.data['players']).toEqual([{ id: 'p1', seatIndex: 0, name: 'Alice' }]);
  });

  // ISSUE-005 — spectator broadcast view requires role+side to make it
  // through the public filter so the spectator surface can reveal every
  // role from t=0. Agents never read this stream (they get private info
  // via the decision-request envelope), so passing role/side here does not
  // violate the live-game info isolation invariant.
  it('preserves role + side per player on match.started for spectator reveal', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'match.started',
      data: {
        gameId: 'g-1',
        seed: 'seed-1',
        players: [
          { id: 'p1', seatIndex: 0, name: 'Alice', role: 'werewolf', side: 'werewolf' },
          { id: 'p2', seatIndex: 1, name: 'Bob', role: 'seer', side: 'good' },
        ],
      },
    };
    const out = werewolfReplayEventToPublic(e)!;
    expect(out.data['players']).toEqual([
      { id: 'p1', seatIndex: 0, name: 'Alice', role: 'werewolf', side: 'werewolf' },
      { id: 'p2', seatIndex: 1, name: 'Bob', role: 'seer', side: 'good' },
    ]);
    // seed is still stripped — that's separate from role reveal.
    expect(out.data['seed']).toBeUndefined();
  });

  it('passes match.started through unchanged when no seed is present', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'match.started',
      data: {
        gameId: 'g-1',
        players: [{ id: 'p1', seatIndex: 0, name: 'Alice' }],
      },
    };
    expect(werewolfReplayEventToPublic(e)).toBe(e);
  });

  it('passes match.completed through unchanged', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'match.completed',
      data: { gameId: 'g-1', winner: 'good', durationMs: 12, stepCount: 7 },
    };
    expect(werewolfReplayEventToPublic(e)).toEqual(e);
  });

  it('passes phase.changed through unchanged', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'phase.changed',
      data: { from: 'night-werewolf-vote', to: 'night-witch' },
    };
    expect(werewolfReplayEventToPublic(e)).toEqual(e);
  });

  it('strips playerId from agent.action_requested in private night phases', () => {
    for (const phase of ['night-werewolf-vote', 'night-witch', 'night-seer']) {
      const e: WerewolfReplayEvent = {
        ...baseEvent,
        eventType: 'agent.action_requested',
        data: {
          requestId: 'req-1',
          agentId: 'agent-x',
          playerId: 'p3',
          phase,
          validActionCount: 1,
        },
      };
      const out = werewolfReplayEventToPublic(e);
      expect(out).not.toBeNull();
      expect(out!.data['playerId']).toBeUndefined();
      expect(out!.data['agentId']).toBeUndefined();
      expect(out!.data['phase']).toBe(phase); // phase stays — it doesn't reveal *which* player
      expect(out!.data['requestId']).toBe('req-1');
    }
  });

  it('keeps playerId on agent.action_requested in public phases', () => {
    for (const phase of ['day-speeches', 'day-vote', 'hunter-shoot']) {
      const e: WerewolfReplayEvent = {
        ...baseEvent,
        eventType: 'agent.action_requested',
        data: { requestId: 'r', agentId: 'a', playerId: 'p3', phase, validActionCount: 1 },
      };
      const out = werewolfReplayEventToPublic(e)!;
      expect(out.data['playerId']).toBe('p3');
    }
  });

  it('strips actor identity from agent.action_received in private phases', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'agent.action_received',
      data: {
        requestId: 'r',
        agentId: 'a',
        playerId: 'p2',
        phase: 'night-werewolf-vote',
        action: { type: 'werewolf-vote' },
        usedFallback: false,
        timedOut: false,
        elapsedMs: 100,
      },
    };
    const out = werewolfReplayEventToPublic(e)!;
    expect(out.data['playerId']).toBeUndefined();
    expect(out.data['agentId']).toBeUndefined();
    expect(out.data['action']).toEqual({ type: 'werewolf-vote' });
  });

  it('strips actor identity from agent.timeout in private phases', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'agent.timeout',
      data: {
        requestId: 'r', agentId: 'a', playerId: 'p2',
        phase: 'night-witch', elapsedMs: 5000,
        fallbackAction: { type: 'witch-skip-save' },
      },
    };
    const out = werewolfReplayEventToPublic(e)!;
    expect(out.data['playerId']).toBeUndefined();
    expect(out.data['agentId']).toBeUndefined();
  });

  it('strips actor identity from agent.invalid_action in private phases', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'agent.invalid_action',
      data: {
        requestId: 'r', agentId: 'a', playerId: 'p2',
        phase: 'night-seer', reason: 'bad target',
        fallbackAction: { type: 'seer-divine' },
      },
    };
    const out = werewolfReplayEventToPublic(e)!;
    expect(out.data['playerId']).toBeUndefined();
    expect(out.data['agentId']).toBeUndefined();
    expect(out.data['reason']).toBe('bad target');
  });

  it('passes inner through on speak action (inner is intentionally public)', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'engine.action_applied',
      data: {
        phase: 'day-speeches',
        action: { type: 'speak', playerId: 'p1', inner: 'my thoughts', performance: 'X', speech: 'Y' },
        newPhase: 'day-speeches',
      },
    };
    const out = werewolfReplayEventToPublic(e)!;
    const action = out.data['action'] as Record<string, unknown>;
    expect(action['inner']).toBe('my thoughts');
    expect(action['performance']).toBe('X');
  });

  it('returns the same reference when nothing needs redacting (cheap pass-through)', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'phase.changed',
      data: { from: 'day-vote', to: 'day-resolve' },
    };
    expect(werewolfReplayEventToPublic(e)).toBe(e);
  });
});
