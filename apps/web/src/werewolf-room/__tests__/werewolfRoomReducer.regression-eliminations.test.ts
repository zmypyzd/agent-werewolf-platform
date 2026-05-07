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

  it('lobby-sync DOES NOT clobber alive=false set by an earlier phase.changed', async () => {
    // Bug #2 found by /qa on 2026-05-06: REST polling fires lobby-sync
    // every 2-5s during a running match. The handler used to hardcode
    // alive:true for every seat, wiping mid-match deaths the moment the
    // next poll arrived. The seat board flickered briefly red before
    // resetting — so visually nothing ever showed as dead until match-
    // completed (which carries finalPlayers[]). Fix: lobby-sync now
    // preserves alive / revealedRole / revealedSide from the prior seat
    // for the same playerId, since the server's lobby entry shape doesn't
    // carry those fields anyway.
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterDeath = werewolfRoomReducer(seeded, {
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
    expect(afterDeath.seats.find((s) => s.playerId === 'p5')!.alive).toBe(false);

    // A second lobby-sync fires (e.g. from the 5s poll). The lobby entry
    // shape has no `alive` field, but it must not clobber the prior state.
    const afterSync = werewolfRoomReducer(afterDeath, SEEDED_LOBBY);
    expect(afterSync.seats.find((s) => s.playerId === 'p5')!.alive).toBe(false);
    // And the rest of the players stay alive (the preservation must not
    // accidentally flip live seats to dead).
    for (const s of afterSync.seats) {
      if (s.playerId === 'p5') continue;
      expect(s.alive).toBe(true);
    }
  });

  it('lobby-sync preserves revealedRole / revealedSide once a match completes', async () => {
    // Same shape as the alive preservation, but for the role-reveal fields
    // populated by match-completed. Without preservation, a poll that
    // races match-completed would briefly hide the revealed roles before
    // the next match-completed dispatch re-applied them. Stable by design.
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterCompleted = werewolfRoomReducer(seeded, {
      type: 'match-completed',
      winner: 'good',
      finalPlayers: [
        { id: 'p1', seatIndex: 0, name: 'Bot 1', role: 'werewolf', side: 'werewolf', alive: false },
        { id: 'p3', seatIndex: 2, name: 'Bot 3', role: 'seer', side: 'good', alive: true },
      ],
    });
    expect(afterCompleted.seats.find((s) => s.playerId === 'p1')!.revealedRole).toBe('werewolf');

    const afterSync = werewolfRoomReducer(afterCompleted, {
      type: 'lobby-sync',
      entry: { ...SEEDED_LOBBY.entry, status: 'completed' },
    });
    expect(afterSync.seats.find((s) => s.playerId === 'p1')!.revealedRole).toBe('werewolf');
    expect(afterSync.seats.find((s) => s.playerId === 'p1')!.revealedSide).toBe('werewolf');
    expect(afterSync.seats.find((s) => s.playerId === 'p1')!.alive).toBe(false);
    expect(afterSync.seats.find((s) => s.playerId === 'p3')!.revealedRole).toBe('seer');
  });

  // ISSUE-004 — seats only said "✝ 已淘汰" no matter how the player died.
  // The reducer now propagates the cause from event.data.eliminated[].cause
  // into seat.causeOfDeath so the table surface can render distinct text
  // ("✝ 被狼刀" / "✝ 被毒" / "✝ 被放逐" / "✝ 被开枪").
  describe('seat.causeOfDeath propagation', () => {
    it('writes seat.causeOfDeath="wolf-kill" when phase.changed elimination cause is wolf-kill', async () => {
      const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
      const after = werewolfRoomReducer(seeded, {
        type: 'replay-event',
        event: makeEvent({
          eventType: 'phase.changed',
          data: {
            phase: 'day-announce',
            nightNumber: 1,
            dayNumber: 1,
            eliminated: [{ playerId: 'p2', cause: 'wolf-kill' }],
          },
        }),
      });
      const seat = after.seats.find((s) => s.playerId === 'p2')!;
      expect(seat.alive).toBe(false);
      expect(seat.causeOfDeath).toBe('wolf-kill');
    });

    it('writes distinct causes per eliminated entry in a multi-death tick', async () => {
      const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
      const after = werewolfRoomReducer(seeded, {
        type: 'replay-event',
        event: makeEvent({
          eventType: 'phase.changed',
          data: {
            phase: 'day-speeches',
            nightNumber: 1,
            dayNumber: 1,
            eliminated: [
              { playerId: 'p3', cause: 'wolf-kill' },
              { playerId: 'p4', cause: 'witch-poison' },
            ],
          },
        }),
      });
      expect(after.seats.find((s) => s.playerId === 'p3')!.causeOfDeath).toBe('wolf-kill');
      expect(after.seats.find((s) => s.playerId === 'p4')!.causeOfDeath).toBe('witch-poison');
    });

    it('writes seat.causeOfDeath="banishment" / "hunter-shoot" through the same path', async () => {
      const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
      const banished = werewolfRoomReducer(seeded, {
        type: 'replay-event',
        event: makeEvent({
          eventType: 'phase.changed',
          data: {
            phase: 'hunter-shoot',
            nightNumber: 1,
            dayNumber: 1,
            eliminated: [{ playerId: 'p5', cause: 'banishment' }],
          },
        }),
      });
      expect(banished.seats.find((s) => s.playerId === 'p5')!.causeOfDeath).toBe('banishment');

      const shot = werewolfRoomReducer(banished, {
        type: 'replay-event',
        event: makeEvent({
          eventType: 'phase.changed',
          data: {
            phase: 'night-werewolf-vote',
            nightNumber: 2,
            dayNumber: 1,
            eliminated: [{ playerId: 'p7', cause: 'hunter-shoot' }],
          },
        }),
      });
      expect(shot.seats.find((s) => s.playerId === 'p7')!.causeOfDeath).toBe('hunter-shoot');
    });

    it('seat.causeOfDeath survives a subsequent lobby-sync poll', async () => {
      const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
      const afterDeath = werewolfRoomReducer(seeded, {
        type: 'replay-event',
        event: makeEvent({
          eventType: 'phase.changed',
          data: {
            phase: 'day-announce',
            nightNumber: 1,
            dayNumber: 1,
            eliminated: [{ playerId: 'p1', cause: 'wolf-kill' }],
          },
        }),
      });
      const afterSync = werewolfRoomReducer(afterDeath, SEEDED_LOBBY);
      const seat = afterSync.seats.find((s) => s.playerId === 'p1')!;
      expect(seat.alive).toBe(false);
      expect(seat.causeOfDeath).toBe('wolf-kill');
    });

    it('living seats have no causeOfDeath', async () => {
      const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
      const after = werewolfRoomReducer(seeded, {
        type: 'replay-event',
        event: makeEvent({
          eventType: 'phase.changed',
          data: {
            phase: 'day-announce',
            nightNumber: 1,
            dayNumber: 1,
            eliminated: [{ playerId: 'p2', cause: 'wolf-kill' }],
          },
        }),
      });
      for (const s of after.seats) {
        if (s.playerId === 'p2') continue;
        expect(s.causeOfDeath).toBeUndefined();
      }
    });
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
