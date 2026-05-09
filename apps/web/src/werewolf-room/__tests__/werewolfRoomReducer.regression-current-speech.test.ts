import { describe, it, expect } from 'vitest';
import { werewolfRoomReducer } from '../werewolfRoomReducer.js';
import { emptyRoomState, type WerewolfReplayEvent } from '../werewolfRoomTypes.js';

// Regression: 中央发言板 (broadcast-booth speech panel) requires the reducer
// to surface the active speech as state. Without `currentSpeech`, the
// component had no way to render the speaker's actual transcript — only
// who was speaking. The reducer must:
//   1. Populate currentSpeech from agent.action_received (speak)
//   2. Hold it across non-speak events (votes etc.) so the spectator can
//      keep reading while the next agent thinks
//   3. Clear it on phase.changed and match completion

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

describe('werewolfRoomReducer — currentSpeech', () => {
  it('agent.action_received (speak) populates currentSpeech with text + performance + intent', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p3',
          action: {
            type: 'speak',
            playerId: 'p3',
            inner: 'I am the seer.',
            performance: 'leans forward, calm',
            speech: 'I checked P5 last night, clean villager.',
          },
          reasoningSummary: { intent: 'Establish credibility', confidence: 0.7, keyObservations: [] },
        },
      }),
    });
    expect(after.currentSpeech).toBeDefined();
    expect(after.currentSpeech?.actorId).toBe('p3');
    expect(after.currentSpeech?.text).toBe('I checked P5 last night, clean villager.');
    expect(after.currentSpeech?.performance).toBe('leans forward, calm');
    expect(after.currentSpeech?.intent).toBe('Establish credibility');
  });

  it('speak without performance/intent leaves those fields undefined (exactOptionalPropertyTypes)', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p1',
          action: { type: 'speak', playerId: 'p1', inner: '', performance: '', speech: 'Pass.' },
        },
      }),
    });
    expect(after.currentSpeech?.text).toBe('Pass.');
    expect(after.currentSpeech?.performance).toBeUndefined();
    expect(after.currentSpeech?.intent).toBeUndefined();
  });

  it('non-speak action (day-vote) preserves currentSpeech so spectators can finish reading', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterSpeech = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p4',
          action: { type: 'speak', playerId: 'p4', inner: '', performance: '', speech: 'I vote P9.' },
        },
      }),
    });
    expect(afterSpeech.currentSpeech?.actorId).toBe('p4');

    const afterVote = werewolfRoomReducer(afterSpeech, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-vote',
          playerId: 'p1',
          action: { type: 'day-vote', voterId: 'p1', targetId: 'p9' },
        },
      }),
    });
    // speakingActor cleared, but currentSpeech intentionally retained
    expect(afterVote.speakingActor).toBeUndefined();
    expect(afterVote.currentSpeech?.actorId).toBe('p4');
    expect(afterVote.currentSpeech?.text).toBe('I vote P9.');
  });

  it('phase.changed to day-vote KEEPS currentSpeech so the last speaker stays on the booth', () => {
    // Regression: when the LAST living player's speak action lands, the
    // engine immediately advances day-speeches → day-vote (see
    // packages/werewolf-engine/src/apply-action.ts applySpeak). The
    // orchestrator then emits agent.action_received followed back-to-back by
    // phase.changed { phase: 'day-vote' }. Previously the reducer cleared
    // currentSpeech on every phase.changed, so the last speaker's card was
    // set and cleared in the same render batch — the spectator perceived it
    // as the speech board "skipping" that player even though the timeline
    // still showed the line. The fix keeps currentSpeech across the
    // day-speeches → day-vote transition (PK revotes also stay on
    // 'day-vote' so they're covered by the same condition).
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterSpeech = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p9',
          action: { type: 'speak', playerId: 'p9', inner: '', performance: '', speech: 'Last word.' },
        },
      }),
    });
    expect(afterSpeech.currentSpeech?.actorId).toBe('p9');

    const afterPhaseChange = werewolfRoomReducer(afterSpeech, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
    });
    expect(afterPhaseChange.currentPhase).toBe('day-vote');
    expect(afterPhaseChange.currentSpeech?.actorId).toBe('p9');
    expect(afterPhaseChange.currentSpeech?.text).toBe('Last word.');
    // speakingActor is still cleared so the seat glow flips into replay mode.
    expect(afterPhaseChange.speakingActor).toBeUndefined();
  });

  it('phase.changed to a night phase clears currentSpeech (info-isolation + new round)', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterSpeech = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p2',
          action: { type: 'speak', playerId: 'p2', inner: '', performance: '', speech: 'Hello.' },
        },
      }),
    });
    expect(afterSpeech.currentSpeech).toBeDefined();

    const afterPhaseChange = werewolfRoomReducer(afterSpeech, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 2 },
      }),
    });
    expect(afterPhaseChange.currentSpeech).toBeUndefined();
  });

  it('phase.changed from day-vote → night-werewolf-vote clears currentSpeech (round ends)', () => {
    // Companion to the day-vote retention test: once voting finalizes and
    // the engine advances into the next night, the carried-over last
    // speech must NOT bleed into the night surface. The night overlay
    // covers the booth but currentSpeech still drives seat-glow replay,
    // which would otherwise pin the prior day's last speaker as
    // "still talking" through the night.
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterSpeech = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p9',
          action: { type: 'speak', playerId: 'p9', inner: '', performance: '', speech: 'Last word.' },
        },
      }),
    });
    const inDayVote = werewolfRoomReducer(afterSpeech, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
    });
    expect(inDayVote.currentSpeech?.actorId).toBe('p9');

    const intoNight = werewolfRoomReducer(inDayVote, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 2 },
      }),
    });
    expect(intoNight.currentSpeech).toBeUndefined();
  });

  it('phase.changed PK revote (phase stays day-vote) preserves currentSpeech', () => {
    // packages/werewolf-orchestrator/src/match-runner.ts re-emits
    // phase.changed with phase === 'day-vote' on a PK round bump. The
    // carried-over last speech must survive these emissions; otherwise
    // every PK round would clear the booth that the spectator is still
    // reading.
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterSpeech = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p9',
          action: { type: 'speak', playerId: 'p9', inner: '', performance: '', speech: 'Last word.' },
        },
      }),
    });
    const intoVote = werewolfRoomReducer(afterSpeech, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
    });
    const pkRevote = werewolfRoomReducer(intoVote, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1, pkRound: 1 },
      }),
    });
    expect(pkRevote.currentPhase).toBe('day-vote');
    expect(pkRevote.currentSpeech?.actorId).toBe('p9');
    expect(pkRevote.currentSpeech?.text).toBe('Last word.');
  });

  it('phase.changed from day-vote → hunter-shoot clears currentSpeech (action context shifts)', () => {
    // After a hunter is banished, phase advances to hunter-shoot. The
    // carried-over day speech is no longer the active broadcast — the
    // hunter is about to fire. Clear so the booth doesn't display stale
    // copy while the hunter's seat takes focus.
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterSpeech = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p9',
          action: { type: 'speak', playerId: 'p9', inner: '', performance: '', speech: 'Last word.' },
        },
      }),
    });
    const intoVote = werewolfRoomReducer(afterSpeech, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
    });
    expect(intoVote.currentSpeech?.actorId).toBe('p9');

    const intoHunter = werewolfRoomReducer(intoVote, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'hunter-shoot', dayNumber: 1, eliminated: [{ playerId: 'p3', cause: 'banishment' }] },
      }),
    });
    expect(intoHunter.currentSpeech).toBeUndefined();
  });

  it('phase.changed to game-over clears currentSpeech (game ended)', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterSpeech = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p9',
          action: { type: 'speak', playerId: 'p9', inner: '', performance: '', speech: 'Last word.' },
        },
      }),
    });
    const ended = werewolfRoomReducer(afterSpeech, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'game-over' },
      }),
    });
    expect(ended.currentSpeech).toBeUndefined();
  });

  it('match.completed event clears currentSpeech', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterSpeech = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p1',
          action: { type: 'speak', playerId: 'p1', inner: '', performance: '', speech: 'Final.' },
        },
      }),
    });
    const afterCompletion = werewolfRoomReducer(afterSpeech, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'match.completed',
        data: { winner: 'good' },
      }),
    });
    expect(afterCompletion.currentSpeech).toBeUndefined();
  });

  it('match-completed action (from REST poll) clears currentSpeech', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const afterSpeech = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p1',
          action: { type: 'speak', playerId: 'p1', inner: '', performance: '', speech: 'Final.' },
        },
      }),
    });
    const after = werewolfRoomReducer(afterSpeech, {
      type: 'match-completed',
      winner: 'good',
      finalPlayers: [],
    });
    expect(after.currentSpeech).toBeUndefined();
  });

  it('night-phase speak (info isolation) does NOT populate currentSpeech', () => {
    // Defensive: even if the API ever leaked a speak event during night,
    // currentSpeech should not surface it (it'd be a wolf private channel).
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const inNight = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 1 },
      }),
    });
    const after = werewolfRoomReducer(inNight, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'night-werewolf-vote',
          playerId: 'p7',
          action: { type: 'speak', playerId: 'p7', inner: '', performance: '', speech: 'WOLF CHAT' },
        },
      }),
    });
    expect(after.currentSpeech).toBeUndefined();
    expect(after.speakingActor).toBeUndefined();
  });
});
