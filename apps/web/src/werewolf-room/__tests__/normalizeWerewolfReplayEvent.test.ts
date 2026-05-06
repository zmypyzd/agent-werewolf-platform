import { describe, it, expect } from 'vitest';
import { normalizeWerewolfReplayEvent } from '../normalizeWerewolfReplayEvent.js';
import type { WerewolfReplayEvent } from '../werewolfRoomTypes.js';

const NAME_INDEX: Record<string, string> = {
  p1: 'Bot 1', p2: 'Bot 2', p3: 'Bot 3', p4: 'Bot 4',
  p5: 'Bot 5', p6: 'Bot 6', p7: 'Bot 7', p8: 'Bot 8', p9: 'Bot 9',
};

function makeEvent(partial: Partial<WerewolfReplayEvent>): WerewolfReplayEvent {
  return {
    eventId: 'eid',
    gameId: 'g',
    sequence: 0,
    eventType: 'engine.action_applied',
    timestamp: 0,
    data: {},
    ...partial,
  } as WerewolfReplayEvent;
}

describe('normalizeWerewolfReplayEvent', () => {
  it('match.started → "对局开始"', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({ eventType: 'match.started', timestamp: 100 }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('system');
    expect(line?.text).toBe('对局开始');
  });

  it('phase.changed to night-* → "🌙 夜 N"', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 2 },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('phase-night');
    expect(line?.text).toContain('夜 2');
  });

  it('phase.changed to day-* → "☀️ 天 N"', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-speeches', dayNumber: 1 },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('phase-day');
    expect(line?.text).toContain('天 1');
  });

  it('agent.action_received vote → "<name> 投 <target>"', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-vote',
          playerId: 'p3',
          action: { type: 'vote', targetId: 'p7' },
        },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('vote');
    expect(line?.text).toBe('Bot 3 投 Bot 7');
  });

  it('agent.action_received speak → "<name> 发言"', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p2',
          action: { type: 'speak', text: 'hi' },
        },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('speak');
    expect(line?.text).toBe('Bot 2 发言');
  });

  it('agent.action_received in night-* phase returns null (folded by reducer)', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'night-werewolf-vote',
          action: { type: 'werewolf-vote', targetId: 'p5' },
        },
      }),
      NAME_INDEX,
    );
    expect(line).toBeNull();
  });

  it('match.completed → completion line with winner', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'match.completed',
        data: { winner: 'good' },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('completion');
    expect(line?.text).toContain('好人胜');
  });

  it('engine.action_applied (non-speak/vote) → "system" line', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'engine.action_applied',
        data: { phase: 'day-resolve', action: { type: 'resolve' } },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('system');
  });
});
