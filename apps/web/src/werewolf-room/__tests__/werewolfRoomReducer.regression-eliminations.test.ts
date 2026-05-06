import { describe, it, expect } from 'vitest';
import { werewolfRoomReducer } from '../werewolfRoomReducer.js';
import { emptyRoomState, type WerewolfReplayEvent } from '../werewolfRoomTypes.js';

// Phase 2 scope: phase.changed events now carry an `eliminated` array (and a
// `pkRound` number) in event.data. The reducer must:
//   1. Flip seat.alive=false for any playerId in eliminated[]
//   2. Survive a phase.changed with no eliminated field (must not corrupt seats)
//   3. Reflect death in seats DURING the match, not only on match-completed

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

describe('werewolfRoomReducer — phase.changed eliminations', () => {
  it('flips seat.alive=false for every playerId in event.data.eliminated', async () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    expect(seeded.seats.every((s) => s.alive)).toBe(true);

    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: {
          phase: 'day-announce',
          nightNumber: 1,
          dayNumber: 1,
          eliminated: [
            { playerId: 'p5', cause: 'wolf-kill' },
            { playerId: 'p2', cause: 'witch-poison' },
          ],
        },
      }),
    });

    expect(after.seats.find((s) => s.playerId === 'p5')!.alive).toBe(false);
    expect(after.seats.find((s) => s.playerId === 'p2')!.alive).toBe(false);
    // Every other seat stays alive
    for (const s of after.seats) {
      if (s.playerId === 'p5' || s.playerId === 'p2') continue;
      expect(s.alive).toBe(true);
    }
  });

  it('phase.changed without eliminated field leaves seats untouched', async () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-speeches', dayNumber: 1, nightNumber: 1 },
      }),
    });
    expect(after.seats.every((s) => s.alive)).toBe(true);
  });

  it('phase.changed with malformed eliminated entry skips that entry, applies the rest', async () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: {
          phase: 'day-resolve',
          nightNumber: 1,
          dayNumber: 1,
          eliminated: [
            { playerId: 'p7', cause: 'banishment' },
            // Defensive: cause missing → entry is dropped, p3 stays alive
            { playerId: 'p3' },
            // playerId missing → dropped, no exception
            { cause: 'banishment' },
            // not an object → dropped
            'p9',
            null,
          ],
        },
      }),
    });
    expect(after.seats.find((s) => s.playerId === 'p7')!.alive).toBe(false);
    expect(after.seats.find((s) => s.playerId === 'p3')!.alive).toBe(true);
    expect(after.seats.find((s) => s.playerId === 'p9')!.alive).toBe(true);
  });

  it('elimination is preserved across subsequent phase.changed events', async () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    // Day announce kills p5
    const afterAnnounce = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: {
          phase: 'day-announce',
          nightNumber: 1,
          dayNumber: 1,
          eliminated: [{ playerId: 'p5', cause: 'wolf-kill' }],
        },
      }),
    });
    // Then several phase changes follow with no new deaths
    const afterSpeeches = werewolfRoomReducer(afterAnnounce, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-speeches', nightNumber: 1, dayNumber: 1 },
      }),
    });
    const afterVote = werewolfRoomReducer(afterSpeeches, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', nightNumber: 1, dayNumber: 1 },
      }),
    });
    expect(afterVote.seats.find((s) => s.playerId === 'p5')!.alive).toBe(false);
  });

  it('PK revote phase.changed with pkRound>=1 does NOT touch alive flags', async () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    // Pretend p5 died at night
    const afterAnnounce = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: {
          phase: 'day-announce',
          nightNumber: 1,
          dayNumber: 1,
          eliminated: [{ playerId: 'p5', cause: 'wolf-kill' }],
        },
      }),
    });
    // Day-vote starts (round 0)
    const afterVote = werewolfRoomReducer(afterAnnounce, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', nightNumber: 1, dayNumber: 1 },
      }),
    });
    // PK round 1 fires
    const afterPk = werewolfRoomReducer(afterVote, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', nightNumber: 1, dayNumber: 1, pkRound: 1 },
      }),
    });
    // p5 still dead, no new deaths from PK transition itself
    expect(afterPk.seats.find((s) => s.playerId === 'p5')!.alive).toBe(false);
    expect(afterPk.seats.filter((s) => !s.alive).length).toBe(1);
  });
});
