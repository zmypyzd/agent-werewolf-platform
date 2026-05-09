import { describe, it, expect } from 'vitest';
import { werewolfRoomReducer } from '../werewolfRoomReducer.js';
import { emptyRoomState, type WerewolfReplayEvent } from '../werewolfRoomTypes.js';

// Regression: the server-side lobby entry now carries currentPhase /
// dayNumber / nightNumber once status flips to 'running' / 'completed'.
// The reducer must apply them on lobby-sync ONLY while the local state
// is still at its initial 'pre-match' value — once an SSE phase.changed
// has set a real phase, a subsequent poll can carry a stale snapshot
// and would otherwise overwrite the fresher SSE reading.
//
// Companion to the backend change in apps/api/src/werewolf-lobby-registry.ts
// which mirrors phase metadata onto InternalEntry from the same
// phase.changed subscription that already tracks deaths.

const BASE_LOBBY_SEATS = Array.from({ length: 9 }, (_, i) => ({
  seatIndex: i,
  playerId: `p${i + 1}`,
  occupant: {
    kind: 'npc' as const,
    agentId: `agent-p${i + 1}`,
    displayName: `Bot ${i + 1}`,
  },
}));

function lobbyEntry(overrides: Record<string, unknown>) {
  return {
    type: 'lobby-sync' as const,
    entry: {
      gameId: 'g1',
      name: 'demo',
      status: 'running' as const,
      seats: BASE_LOBBY_SEATS,
      createdAt: 0,
      startedAt: 1,
      ...overrides,
    },
  };
}

describe('werewolfRoomReducer — lobby phase backfill', () => {
  it('applies currentPhase / dayNumber / nightNumber from lobby entry while state is still pre-match', () => {
    const initial = emptyRoomState('g1');
    expect(initial.currentPhase).toBe('pre-match');

    const next = werewolfRoomReducer(
      initial,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lobbyEntry({ currentPhase: 'night-witch', nightNumber: 2, dayNumber: 1 }) as any,
    );
    expect(next.currentPhase).toBe('night-witch');
    expect(next.nightNumber).toBe(2);
    expect(next.dayNumber).toBe(1);
  });

  it('does NOT overwrite a real phase that SSE has already set', () => {
    // Simulate the live ordering: lobby-sync arrives first with no phase
    // (the initial poll), then an SSE phase.changed lands and sets
    // currentPhase to 'day-vote', then a later lobby-sync arrives with
    // a stale snapshot showing the *previous* phase 'night-witch'. The
    // reducer must keep 'day-vote' — anti-staleness guard.
    let state = emptyRoomState('g1');
    state = werewolfRoomReducer(state, lobbyEntry({}));
    expect(state.status).toBe('running');
    expect(state.currentPhase).toBe('pre-match');

    const sseEvent: WerewolfReplayEvent = {
      eventId: 'e1',
      gameId: 'g1',
      sequence: 1,
      eventType: 'phase.changed',
      timestamp: 100,
      data: { phase: 'day-vote', dayNumber: 1, nightNumber: 0 },
    };
    state = werewolfRoomReducer(state, { type: 'replay-event', event: sseEvent });
    expect(state.currentPhase).toBe('day-vote');

    // Stale poll — older snapshot reflecting the prior phase.
    state = werewolfRoomReducer(
      state,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lobbyEntry({ currentPhase: 'night-witch', dayNumber: 0, nightNumber: 1 }) as any,
    );
    expect(state.currentPhase).toBe('day-vote');
    expect(state.dayNumber).toBe(1);
  });

  it('ignores an explicit currentPhase=pre-match in the lobby entry (treated as "no real phase yet")', () => {
    // Defense-in-depth: even if a server bug ever sends currentPhase='pre-match'
    // alongside status='running', the reducer should treat it as the empty
    // signal — applying it would just reset to the initial value that
    // WerewolfPhaseIndicator already paints, with no information gain.
    const initial = emptyRoomState('g1');
    const next = werewolfRoomReducer(
      initial,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lobbyEntry({ currentPhase: 'pre-match', dayNumber: 0, nightNumber: 0 }) as any,
    );
    expect(next.currentPhase).toBe('pre-match');
    // dayNumber/nightNumber from the entry are still applied since they're
    // numeric and meaningful even pre-phase.
    expect(next.dayNumber).toBe(0);
    expect(next.nightNumber).toBe(0);
  });

  it('preserves existing dayNumber / nightNumber if the lobby entry omits them after SSE took over', () => {
    let state = emptyRoomState('g1');
    state = werewolfRoomReducer(state, lobbyEntry({}));
    const sseEvent: WerewolfReplayEvent = {
      eventId: 'e1',
      gameId: 'g1',
      sequence: 1,
      eventType: 'phase.changed',
      timestamp: 100,
      data: { phase: 'day-vote', dayNumber: 3, nightNumber: 2 },
    };
    state = werewolfRoomReducer(state, { type: 'replay-event', event: sseEvent });
    expect(state.dayNumber).toBe(3);
    expect(state.nightNumber).toBe(2);

    // Lobby-sync without phase metadata (e.g. status='waiting' edge case
    // or a transient server response): existing values must survive.
    state = werewolfRoomReducer(state, lobbyEntry({}));
    expect(state.dayNumber).toBe(3);
    expect(state.nightNumber).toBe(2);
    expect(state.currentPhase).toBe('day-vote');
  });
});
