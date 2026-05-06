import { describe, it, expect } from 'vitest';
import { werewolfRoomReducer } from '../werewolfRoomReducer.js';
import { emptyRoomState } from '../werewolfRoomTypes.js';
import type { WerewolfReplayEvent } from '../werewolfRoomTypes.js';

// Regression: ISSUE-003 — engine.action_applied and agent.action_requested
// fell through to a fallback that returned a "[event-type]" system line,
// which (a) flooded the spectator timeline with raw event names and (b)
// blocked the night-fold dedupe in the reducer (which only fires when the
// normalizer returns []). A typical 9-AI match produced hundreds of
// "[engine.action_applied]" lines instead of a single "🌙 夜 N · 行动中…"
// fold per night phase.
// Found by /qa on 2026-05-06.
// Report: .gstack/qa-reports/qa-report-localhost-2026-05-06.md

function makeEvent(partial: Partial<WerewolfReplayEvent>): WerewolfReplayEvent {
  return {
    eventId: `eid-${Math.random()}`,
    gameId: 'g1',
    sequence: 0,
    eventType: 'engine.action_applied',
    timestamp: 1,
    data: {},
    ...partial,
  } as WerewolfReplayEvent;
}

const SEEDED_LOBBY = {
  type: 'lobby-sync' as const,
  entry: {
    gameId: 'g1',
    name: 'demo',
    status: 'running' as const,
    createdAt: 0,
    startedAt: 1,
    seats: Array.from({ length: 9 }, (_, i) => ({
      seatIndex: i,
      playerId: `p${i + 1}`,
      occupant: {
        kind: 'npc' as const,
        agentId: `agent-p${i + 1}`,
        displayName: `Bot ${i + 1}`,
      },
    })),
  },
};

describe('werewolf timeline night-fold dedupe', () => {
  it('many engine.action_applied + agent.action_requested in night phase produce at most one fold line', () => {
    let state = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    state = werewolfRoomReducer(state, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 1 },
      }),
    });
    for (let i = 0; i < 30; i++) {
      state = werewolfRoomReducer(state, {
        type: 'replay-event',
        event: makeEvent({
          eventId: `engine-${i}`,
          eventType: 'engine.action_applied',
          data: { phase: 'night-werewolf-vote' },
        }),
      });
      state = werewolfRoomReducer(state, {
        type: 'replay-event',
        event: makeEvent({
          eventId: `req-${i}`,
          eventType: 'agent.action_requested',
          data: { phase: 'night-werewolf-vote', playerId: `p${(i % 9) + 1}` },
        }),
      });
    }

    // Exactly one phase-night line + one night-fold line for the entire run.
    const folds = state.timeline.filter((l) => l.kind === 'system-night-fold');
    const phaseLines = state.timeline.filter((l) => l.kind === 'phase-night');
    expect(phaseLines).toHaveLength(1);
    expect(folds).toHaveLength(1);

    // No raw "[engine.action_applied]" or "[agent.action_requested]" entries.
    const rawNoise = state.timeline.filter((l) => /^\[(engine|agent)\./.test(l.text));
    expect(rawNoise).toHaveLength(0);

    // Total timeline length should be tiny — phase line + 1 fold.
    expect(state.timeline.length).toBeLessThanOrEqual(2);
  });

  it('day-phase engine.action_applied + agent.action_requested produce no extra timeline lines', () => {
    let state = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    state = werewolfRoomReducer(state, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
    });
    const baselineCount = state.timeline.length;
    for (let i = 0; i < 10; i++) {
      state = werewolfRoomReducer(state, {
        type: 'replay-event',
        event: makeEvent({
          eventId: `engine-${i}`,
          eventType: 'engine.action_applied',
          data: { phase: 'day-vote' },
        }),
      });
      state = werewolfRoomReducer(state, {
        type: 'replay-event',
        event: makeEvent({
          eventId: `req-${i}`,
          eventType: 'agent.action_requested',
          data: { phase: 'day-vote', playerId: `p${(i % 9) + 1}` },
        }),
      });
    }
    expect(state.timeline.length).toBe(baselineCount);
  });
});
