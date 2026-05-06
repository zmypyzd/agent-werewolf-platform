import { describe, it, expect } from 'vitest';
import { werewolfRoomReducer } from '../werewolfRoomReducer.js';
import { emptyRoomState } from '../werewolfRoomTypes.js';
import type { WerewolfReplayEvent } from '../werewolfRoomTypes.js';

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

describe('werewolfRoomReducer', () => {
  it('lobby-sync overrides the existing room state', () => {
    const after = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    expect(after.status).toBe('running');
    expect(after.seats[0]!.occupant.kind).toBe('npc');
  });

  it('phase.changed (night-werewolf-vote) sets currentPhase + nightNumber, leaves thinkingActor unset', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 1 },
      }),
    });
    expect(after.currentPhase).toBe('night-werewolf-vote');
    expect(after.nightNumber).toBe(1);
    expect(after.thinkingActor).toBeUndefined();
  });

  it('agent.action_requested in DAY phase sets thinkingActor', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const enteredDay = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
    });
    const after = werewolfRoomReducer(enteredDay, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_requested',
        data: { phase: 'day-vote', playerId: 'p3' },
      }),
    });
    expect(after.thinkingActor).toBe('p3');
  });

  it('agent.action_requested in NIGHT phase NEVER populates thinkingActor (info isolation)', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const enteredNight = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 1 },
      }),
    });
    // Even if a (theoretically impossible) public event ever included a playerId
    // during a night phase, the reducer must still refuse to highlight it.
    const after = werewolfRoomReducer(enteredNight, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_requested',
        data: { phase: 'night-werewolf-vote', playerId: 'p4' },
      }),
    });
    expect(after.thinkingActor).toBeUndefined();
  });

  it('consecutive werewolf-vote events fold into a single system-night-fold line', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const enteredNight = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 1 },
      }),
    });
    let state = enteredNight;
    for (let i = 0; i < 5; i++) {
      state = werewolfRoomReducer(state, {
        type: 'replay-event',
        event: makeEvent({
          eventType: 'agent.action_received',
          data: { phase: 'night-werewolf-vote', action: { type: 'werewolf-vote' } },
        }),
      });
    }
    const fold = state.timeline.filter((l) => l.kind === 'system-night-fold');
    expect(fold).toHaveLength(1);
    expect(fold[0]!.text).toContain('夜 1');
  });

  it('agent.action_requested (day) sets thinkingActor, leaves speakingActor undefined', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_requested',
        data: { phase: 'day-speeches', playerId: 'p3' },
      }),
    });
    expect(after.thinkingActor).toBe('p3');
    expect(after.speakingActor).toBeUndefined();
  });

  it('agent.action_received (speak) sets speakingActor, clears thinkingActor', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const thinking = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_requested',
        data: { phase: 'day-speeches', playerId: 'p3' },
      }),
    });
    const after = werewolfRoomReducer(thinking, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p3',
          action: { type: 'speak', playerId: 'p3', inner: 'x', performance: 'y', speech: 'z' },
        },
      }),
    });
    expect(after.speakingActor).toBe('p3');
    expect(after.thinkingActor).toBeUndefined();
  });

  it('agent.action_received (non-speak) clears both actors', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const thinking = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_requested',
        data: { phase: 'day-vote', playerId: 'p3' },
      }),
    });
    const after = werewolfRoomReducer(thinking, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: { phase: 'day-vote', playerId: 'p3', action: { type: 'day-vote', voterId: 'p3', targetId: 'p2' } },
      }),
    });
    expect(after.thinkingActor).toBeUndefined();
    expect(after.speakingActor).toBeUndefined();
  });

  it('phase.changed clears both actors', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const withSpeaking = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p2',
          action: { type: 'speak', playerId: 'p2', inner: '', performance: '', speech: '' },
        },
      }),
    });
    const after = werewolfRoomReducer(withSpeaking, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
    });
    expect(after.thinkingActor).toBeUndefined();
    expect(after.speakingActor).toBeUndefined();
  });

  it('speak action produces two timeline lines (speak + reason)', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p1',
          action: { type: 'speak', playerId: 'p1', inner: 'x', performance: 'nods', speech: 'I suspect Bot 2.' },
          reasoningSummary: { intent: 'Expose the wolf', confidence: 0.8, keyObservations: [] },
        },
      }),
    });
    expect(after.timeline.some((l) => l.kind === 'speak')).toBe(true);
    expect(after.timeline.some((l) => l.kind === 'reason')).toBe(true);
  });

  it('speak action without reasoningSummary produces one speak line only', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p1',
          action: { type: 'speak', playerId: 'p1', inner: '', performance: '', speech: 'Nothing.' },
        },
      }),
    });
    expect(after.timeline.some((l) => l.kind === 'speak')).toBe(true);
    expect(after.timeline.some((l) => l.kind === 'reason')).toBe(false);
  });

  it('match-completed populates winner + revealed roles + per-seat alive', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'match-completed',
      winner: 'good',
      finalPlayers: [
        { id: 'p1', seatIndex: 0, name: 'Bot 1', role: 'werewolf', side: 'werewolf', alive: false },
        { id: 'p2', seatIndex: 1, name: 'Bot 2', role: 'seer', side: 'good', alive: true },
        { id: 'p3', seatIndex: 2, name: 'Bot 3', role: 'witch', side: 'good', alive: true },
        { id: 'p4', seatIndex: 3, name: 'Bot 4', role: 'hunter', side: 'good', alive: false },
        { id: 'p5', seatIndex: 4, name: 'Bot 5', role: 'villager', side: 'good', alive: true },
        { id: 'p6', seatIndex: 5, name: 'Bot 6', role: 'villager', side: 'good', alive: false },
        { id: 'p7', seatIndex: 6, name: 'Bot 7', role: 'villager', side: 'good', alive: true },
        { id: 'p8', seatIndex: 7, name: 'Bot 8', role: 'werewolf', side: 'werewolf', alive: false },
        { id: 'p9', seatIndex: 8, name: 'Bot 9', role: 'werewolf', side: 'werewolf', alive: false },
      ],
    });
    expect(after.status).toBe('completed');
    expect(after.winner).toBe('good');
    expect(after.seats[0]!.revealedRole).toBe('werewolf');
    expect(after.seats[0]!.alive).toBe(false);
    expect(after.seats[1]!.alive).toBe(true);
  });
});
