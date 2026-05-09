import { describe, it, expect } from 'vitest';
import { werewolfRoomReducer } from '../werewolfRoomReducer.js';
import { emptyRoomState } from '../werewolfRoomTypes.js';
import type { WerewolfReplayEvent } from '../werewolfRoomTypes.js';

// Regression: a stream of agent.action_requested for the very first night
// phase arrives BEFORE any phase.changed event has populated `nightNumber`
// in reducer state. The reducer's night-fold collapse uses
// ``🌙 夜 ${next.nightNumber} · 行动中…`` for the fold text. emptyRoomState
// seeds nightNumber=0, so the user briefly sees "🌙 夜 0 · 行动中…" before
// phase.changed arrives — there is no "night 0" in the game.
//
// Real-world reachability: the orchestrator transitions from setup → night
// (via startFirstNight) without emitting phase.changed, then runs wolf
// votes that fire `agent.action_requested(phase=night-werewolf-vote)`
// directly (see packages/werewolf-orchestrator/src/match-runner.ts:94 +
// :372 — phase.changed only fires when the post-action phase differs
// from the pre-action phase). Spectators that join before the first
// internal phase transition see the bug.
//
// Also: even if nightNumber gets populated later, the dedupe key
// `last.text.includes(`夜 ${next.nightNumber}`)` then has a different
// value than the seed fold, so a second fold line appends. The first
// line of the spectator run thus reads "夜 undefined" *and* the dedupe
// breaks once nightNumber arrives.

function makeEvent(partial: Partial<WerewolfReplayEvent>): WerewolfReplayEvent {
  return {
    eventId: `eid-${Math.random()}`,
    gameId: 'g1',
    sequence: 0,
    eventType: 'agent.action_requested',
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
    // No nightNumber on the lobby entry — mirrors the real registry which
    // does not back-fill nightNumber on the public lobby projection.
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

describe('werewolf timeline night-fold without nightNumber yet', () => {
  it('does not produce "夜 undefined" when night events arrive before phase.changed', () => {
    let state = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);

    // Emit a single agent.action_requested for night-werewolf-vote BEFORE
    // any phase.changed event has set nightNumber. This is the real server
    // emission order at match start.
    state = werewolfRoomReducer(state, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_requested',
        data: { phase: 'night-werewolf-vote', playerId: 'p1' },
      }),
    });

    const folds = state.timeline.filter((l) => l.kind === 'system-night-fold');
    // Either: no fold should be appended until nightNumber is known,
    // OR: the fold text should not contain the literal string "undefined".
    for (const f of folds) {
      expect(f.text).not.toMatch(/undefined|夜 0/);
    }
  });

  it('keeps dedupe working once nightNumber arrives via phase.changed', () => {
    let state = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);

    // 5 night events before phase.changed sets nightNumber.
    for (let i = 0; i < 5; i++) {
      state = werewolfRoomReducer(state, {
        type: 'replay-event',
        event: makeEvent({
          eventId: `pre-${i}`,
          eventType: 'agent.action_requested',
          data: { phase: 'night-werewolf-vote', playerId: `p${(i % 9) + 1}` },
        }),
      });
    }

    // Now phase.changed fires with the canonical nightNumber.
    state = werewolfRoomReducer(state, {
      type: 'replay-event',
      event: makeEvent({
        eventId: 'phase-1',
        eventType: 'phase.changed',
        data: { phase: 'night-witch', nightNumber: 1 },
      }),
    });

    // 5 more events after — these should dedupe into the existing fold.
    for (let i = 0; i < 5; i++) {
      state = werewolfRoomReducer(state, {
        type: 'replay-event',
        event: makeEvent({
          eventId: `post-${i}`,
          eventType: 'agent.action_requested',
          data: { phase: 'night-witch', playerId: `p${(i % 9) + 1}` },
        }),
      });
    }

    const folds = state.timeline.filter((l) => l.kind === 'system-night-fold');
    // Loose bound: at most a couple of folds across the whole sequence,
    // and definitely none containing "undefined" in their text.
    for (const f of folds) {
      expect(f.text).not.toMatch(/undefined|夜 0/);
    }
    expect(folds.length).toBeLessThanOrEqual(2);
  });
});
