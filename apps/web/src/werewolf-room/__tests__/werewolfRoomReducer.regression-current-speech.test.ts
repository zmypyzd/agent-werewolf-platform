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

  it('agent.action_received (speak) populates lastSpeech alongside currentSpeech', () => {
    // lastSpeech mirrors currentSpeech at speak time so the broadcast
    // booth can survive React-18 batching of action_received +
    // phase.changed for the LAST day-speeches speaker.
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p9',
          action: { type: 'speak', playerId: 'p9', inner: '', performance: '', speech: 'Closing argument.' },
        },
      }),
    });
    expect(after.lastSpeech).toBeDefined();
    expect(after.lastSpeech?.actorId).toBe('p9');
    expect(after.lastSpeech?.text).toBe('Closing argument.');
    // Reference equality with currentSpeech keeps useEffect deps stable.
    expect(after.lastSpeech).toBe(after.currentSpeech);
  });

  it('REGRESSION: last day-speech speaker survives the action_received → phase.changed batch', () => {
    // Simulates the exact orchestrator emit pattern in
    // packages/werewolf-orchestrator/src/match-runner.ts when the LAST
    // living player speaks: applySpeak fires startDayVote in the same
    // call, so the runner emits agent.action_received(P9 speak) and
    // immediately phase.changed(day-vote). SSE delivers them in one
    // network frame and React 18 collapses both dispatches into a single
    // render. The reducer must, by the END of that pair, expose
    // lastSpeech=P9 even though currentSpeech has already been cleared
    // by phase.changed. Without this, no UI hook can recover the speech.
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const step1 = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p9',
          action: { type: 'speak', playerId: 'p9', inner: '', performance: '', speech: 'Closing.' },
        },
      }),
    });
    const step2 = werewolfRoomReducer(step1, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
    });
    expect(step2.currentSpeech).toBeUndefined();
    expect(step2.lastSpeech?.actorId).toBe('p9');
    expect(step2.lastSpeech?.text).toBe('Closing.');
    expect(step2.currentPhase).toBe('day-vote');
  });

  it('phase.changed does NOT clear lastSpeech (the whole point of lastSpeech)', () => {
    // Regression for the day-vote disappearing-P9 bug: SSE delivers
    // action_received(P9) + phase.changed(day-vote) inside one network
    // frame; React 18 batches them, the rendered state has
    // currentSpeech=undefined but lastSpeech must stay at P9 so the
    // booth can fade it out gracefully instead of skipping it entirely.
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
    expect(afterSpeech.lastSpeech?.actorId).toBe('p9');

    const afterDayVote = werewolfRoomReducer(afterSpeech, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
    });
    expect(afterDayVote.currentSpeech).toBeUndefined();
    expect(afterDayVote.lastSpeech?.actorId).toBe('p9');
    expect(afterDayVote.lastSpeech?.text).toBe('Last word.');

    const afterNight = werewolfRoomReducer(afterDayVote, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 2 },
      }),
    });
    // Even crossing into night, lastSpeech holds — the component-layer
    // fade is what eventually drops it; the reducer must not.
    expect(afterNight.lastSpeech?.actorId).toBe('p9');
  });

  it('match.completed event clears lastSpeech (game ended, fresh booth)', () => {
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
    const ended = werewolfRoomReducer(afterSpeech, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'match.completed',
        data: { winner: 'good' },
      }),
    });
    expect(ended.lastSpeech).toBeUndefined();
  });

  it('match-completed action (REST poll) clears lastSpeech too', () => {
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
    expect(after.lastSpeech).toBeUndefined();
  });

  it('night-phase speak does NOT populate lastSpeech (info isolation)', () => {
    // Wolf chat / private night speech must not leak through the
    // lastSpeech channel any more than it does through currentSpeech.
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
    expect(after.lastSpeech).toBeUndefined();
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
