import { describe, it, expect } from 'vitest';
import { werewolfRoomReducer } from '../werewolfRoomReducer.js';
import { emptyRoomState, type WerewolfReplayEvent } from '../werewolfRoomTypes.js';

// Regression: ISSUE-005 — when match.started carries role/side per player,
// the reducer must lift them onto SeatVM.revealedRole/Side immediately so
// the spectator surface acts as a "broadcast view" from the start. Living
// seats then render their role badge; dead seats keep showing the cause
// of death (ISSUE-004) — role is conveyed by the badge, not duplicated in
// the status line.

function makeEvent(partial: Partial<WerewolfReplayEvent>): WerewolfReplayEvent {
  return {
    eventId: `eid-${Math.random()}`,
    gameId: 'g1',
    sequence: 0,
    eventType: 'match.started',
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

describe('werewolfRoomReducer — match.started role reveal', () => {
  it('writes seat.revealedRole / revealedSide from match.started.players[]', async () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    expect(seeded.seats.every((s) => s.revealedRole === undefined)).toBe(true);

    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'match.started',
        data: {
          gameId: 'g1',
          seed: 'seed',
          players: [
            { id: 'p1', seatIndex: 0, name: 'Bot 1', role: 'werewolf', side: 'werewolf' },
            { id: 'p2', seatIndex: 1, name: 'Bot 2', role: 'werewolf', side: 'werewolf' },
            { id: 'p3', seatIndex: 2, name: 'Bot 3', role: 'werewolf', side: 'werewolf' },
            { id: 'p4', seatIndex: 3, name: 'Bot 4', role: 'seer', side: 'good' },
            { id: 'p5', seatIndex: 4, name: 'Bot 5', role: 'witch', side: 'good' },
            { id: 'p6', seatIndex: 5, name: 'Bot 6', role: 'hunter', side: 'good' },
            { id: 'p7', seatIndex: 6, name: 'Bot 7', role: 'villager', side: 'good' },
            { id: 'p8', seatIndex: 7, name: 'Bot 8', role: 'villager', side: 'good' },
            { id: 'p9', seatIndex: 8, name: 'Bot 9', role: 'villager', side: 'good' },
          ],
        },
      }),
    });

    expect(after.seats.find((s) => s.playerId === 'p1')!.revealedRole).toBe('werewolf');
    expect(after.seats.find((s) => s.playerId === 'p1')!.revealedSide).toBe('werewolf');
    expect(after.seats.find((s) => s.playerId === 'p4')!.revealedRole).toBe('seer');
    expect(after.seats.find((s) => s.playerId === 'p5')!.revealedRole).toBe('witch');
    expect(after.seats.find((s) => s.playerId === 'p6')!.revealedRole).toBe('hunter');
    expect(after.seats.find((s) => s.playerId === 'p9')!.revealedRole).toBe('villager');
    expect(after.seats.find((s) => s.playerId === 'p9')!.revealedSide).toBe('good');
  });

  it('match.started reveal survives a lobby-sync poll mid-match', async () => {
    // Same preservation pattern as alive / causeOfDeath: REST polling fires
    // lobby-sync periodically, must not clobber the revealed roster.
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterStart = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'match.started',
        data: {
          gameId: 'g1',
          seed: 's',
          players: [
            { id: 'p1', seatIndex: 0, name: 'Bot 1', role: 'werewolf', side: 'werewolf' },
            { id: 'p2', seatIndex: 1, name: 'Bot 2', role: 'villager', side: 'good' },
            { id: 'p3', seatIndex: 2, name: 'Bot 3', role: 'villager', side: 'good' },
            { id: 'p4', seatIndex: 3, name: 'Bot 4', role: 'villager', side: 'good' },
            { id: 'p5', seatIndex: 4, name: 'Bot 5', role: 'villager', side: 'good' },
            { id: 'p6', seatIndex: 5, name: 'Bot 6', role: 'villager', side: 'good' },
            { id: 'p7', seatIndex: 6, name: 'Bot 7', role: 'villager', side: 'good' },
            { id: 'p8', seatIndex: 7, name: 'Bot 8', role: 'villager', side: 'good' },
            { id: 'p9', seatIndex: 8, name: 'Bot 9', role: 'villager', side: 'good' },
          ],
        },
      }),
    });
    const afterPoll = werewolfRoomReducer(afterStart, SEEDED_LOBBY);
    expect(afterPoll.seats.find((s) => s.playerId === 'p1')!.revealedRole).toBe('werewolf');
    expect(afterPoll.seats.find((s) => s.playerId === 'p9')!.revealedRole).toBe('villager');
  });

  it('match.started without role/side fields (legacy) leaves revealedRole undefined', async () => {
    // Defensive: an older orchestrator that omits role/side must not blow up.
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'match.started',
        data: {
          gameId: 'g1',
          seed: 's',
          players: [{ id: 'p1', seatIndex: 0, name: 'Bot 1' }],
        },
      }),
    });
    for (const s of after.seats) {
      expect(s.revealedRole).toBeUndefined();
    }
  });
});
