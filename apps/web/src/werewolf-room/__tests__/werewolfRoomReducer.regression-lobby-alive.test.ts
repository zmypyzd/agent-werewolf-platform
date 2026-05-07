import { describe, it, expect } from 'vitest';
import { werewolfRoomReducer } from '../werewolfRoomReducer.js';
import { emptyRoomState } from '../werewolfRoomTypes.js';

// ISSUE-005 regression: the server now carries alive/causeOfDeath in the lobby
// entry for running and completed games. The reducer must restore dead-player
// state from a lobby-sync poll rather than defaulting every seat to alive:true.
// This matters most for users who reload the page mid-match (WS only delivers
// future events; historical deaths were invisible to late joiners before fix).

function makeLobbySync(seats: Array<{
  seatIndex: number;
  playerId: string;
  alive?: boolean;
  causeOfDeath?: 'wolf-kill' | 'witch-poison' | 'banishment' | 'hunter-shoot';
}>) {
  return {
    type: 'lobby-sync' as const,
    entry: {
      gameId: 'g1',
      name: 'demo',
      status: 'running' as const,
      createdAt: 0,
      startedAt: 1,
      seats: seats.map((s) => ({
        ...s,
        occupant: { kind: 'npc' as const, agentId: `agent-${s.playerId}`, displayName: `Bot ${s.seatIndex + 1}` },
      })),
    },
  };
}

describe('werewolfRoomReducer — ISSUE-005 lobby-sync alive restoration', () => {
  it('marks seats dead when server carries alive:false', () => {
    const state = werewolfRoomReducer(
      emptyRoomState('g1'),
      makeLobbySync([
        { seatIndex: 0, playerId: 'p1', alive: true },
        { seatIndex: 1, playerId: 'p2', alive: false, causeOfDeath: 'wolf-kill' },
        { seatIndex: 2, playerId: 'p3', alive: true },
      ]),
    );
    expect(state.seats[0]?.alive).toBe(true);
    expect(state.seats[1]?.alive).toBe(false);
    expect(state.seats[1]?.causeOfDeath).toBe('wolf-kill');
    expect(state.seats[2]?.alive).toBe(true);
  });

  it('does not reset alive:false when a subsequent poll omits alive (fallback to prev)', () => {
    // Simulate: first poll carries alive state, second poll omits the field
    const first = werewolfRoomReducer(
      emptyRoomState('g1'),
      makeLobbySync([
        { seatIndex: 0, playerId: 'p1', alive: false, causeOfDeath: 'banishment' },
        { seatIndex: 1, playerId: 'p2', alive: true },
      ]),
    );
    expect(first.seats[0]?.alive).toBe(false);

    // Second lobby-sync without alive field — must preserve prev state
    const second = werewolfRoomReducer(first, {
      type: 'lobby-sync' as const,
      entry: {
        gameId: 'g1',
        name: 'demo',
        status: 'running' as const,
        createdAt: 0,
        startedAt: 1,
        seats: [
          { seatIndex: 0, playerId: 'p1', occupant: { kind: 'npc' as const, agentId: 'a1', displayName: 'Bot 1' } },
          { seatIndex: 1, playerId: 'p2', occupant: { kind: 'npc' as const, agentId: 'a2', displayName: 'Bot 2' } },
        ],
      },
    });
    expect(second.seats[0]?.alive).toBe(false);
    expect(second.seats[0]?.causeOfDeath).toBe('banishment');
    expect(second.seats[1]?.alive).toBe(true);
  });

  it('server alive:true overrides locally-dead state (authoritative server wins)', () => {
    // Edge case: if server says alive:true but local WS thought dead — trust server
    const withLocalDeath = werewolfRoomReducer(emptyRoomState('g1'), {
      type: 'replay-event' as const,
      event: {
        eventId: 'e1',
        gameId: 'g1',
        sequence: 1,
        eventType: 'phase.changed',
        timestamp: 1,
        data: { phase: 'day-announce', nightNumber: 1, dayNumber: 1, eliminated: [{ playerId: 'p1', cause: 'wolf-kill' }] },
      },
    });
    // Seed first with a lobby so p1 exists
    const seeded = werewolfRoomReducer(
      werewolfRoomReducer(emptyRoomState('g1'), makeLobbySync([
        { seatIndex: 0, playerId: 'p1', alive: true },
      ])),
      {
        type: 'replay-event' as const,
        event: {
          eventId: 'e1',
          gameId: 'g1',
          sequence: 1,
          eventType: 'phase.changed',
          timestamp: 1,
          data: { phase: 'day-announce', nightNumber: 1, dayNumber: 1, eliminated: [{ playerId: 'p1', cause: 'wolf-kill' }] },
        },
      },
    );
    expect(seeded.seats[0]?.alive).toBe(false);

    // Now server sends alive:true (hypothetical correction) — server wins
    const corrected = werewolfRoomReducer(seeded, makeLobbySync([
      { seatIndex: 0, playerId: 'p1', alive: true },
    ]));
    expect(corrected.seats[0]?.alive).toBe(true);
  });

  it('defaults to alive:true when server field absent and no prior state (pre-start)', () => {
    const state = werewolfRoomReducer(
      emptyRoomState('g1'),
      {
        type: 'lobby-sync' as const,
        entry: {
          gameId: 'g1',
          name: 'demo',
          status: 'waiting' as const,
          createdAt: 0,
          seats: [
            { seatIndex: 0, playerId: 'p1', occupant: { kind: 'empty' as const } },
          ],
        },
      },
    );
    expect(state.seats[0]?.alive).toBe(true);
  });
});
