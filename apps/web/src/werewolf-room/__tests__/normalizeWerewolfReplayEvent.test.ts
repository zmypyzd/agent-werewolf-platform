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
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({ eventType: 'match.started', timestamp: 100 }),
      NAME_INDEX,
    );
    expect(lines[0]?.kind).toBe('system');
    expect(lines[0]?.text).toBe('对局开始');
  });

  it('phase.changed to night-* → "🌙 夜 N"', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 2 },
      }),
      NAME_INDEX,
    );
    expect(lines[0]?.kind).toBe('phase-night');
    expect(lines[0]?.text).toContain('夜 2');
  });

  it('phase.changed to day-* → "☀️ 天 N"', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-speeches', dayNumber: 1 },
      }),
      NAME_INDEX,
    );
    expect(lines[0]?.kind).toBe('phase-day');
    expect(lines[0]?.text).toContain('天 1');
  });

  it('agent.action_received vote → "<name> 投 <target>"', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-vote',
          playerId: 'p3',
          action: { type: 'day-vote', voterId: 'p3', targetId: 'p7' },
        },
      }),
      NAME_INDEX,
    );
    expect(lines[0]?.kind).toBe('vote');
    expect(lines[0]?.text).toBe('Bot 3 投 Bot 7');
  });

  it('agent.action_received speak → "<name>: \\"speech\\""', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p2',
          action: { type: 'speak', playerId: 'p2', inner: '', performance: '', speech: 'hello' },
        },
      }),
      NAME_INDEX,
    );
    expect(lines[0]?.kind).toBe('speak');
    expect(lines[0]?.text).toBe('Bot 2: "hello"');
  });

  it('agent.action_received in night-* phase returns empty array (folded by reducer)', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'night-werewolf-vote',
          action: { type: 'werewolf-vote', targetId: 'p5' },
        },
      }),
      NAME_INDEX,
    );
    expect(lines).toHaveLength(0);
  });

  it('match.completed → completion line with winner', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'match.completed',
        data: { winner: 'good' },
      }),
      NAME_INDEX,
    );
    expect(lines[0]?.kind).toBe('completion');
    expect(lines[0]?.text).toContain('好人胜');
  });

  it('engine.action_applied → no timeline line (effects surface via phase.changed and agent.action_received)', () => {
    // Updated for ISSUE-003 — surfacing engine.action_applied verbatim flooded
    // the timeline with "[engine.action_applied]" entries and also blocked the
    // reducer's night-fold dedupe (which only fires when the normalizer returns []).
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'engine.action_applied',
        data: { phase: 'day-resolve', action: { type: 'resolve' } },
      }),
      NAME_INDEX,
    );
    expect(lines).toEqual([]);
  });

  it('agent.action_received speak → two lines: speak + reason', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p1',
          action: { type: 'speak', playerId: 'p1', inner: 'secret', performance: 'nods slowly', speech: 'I suspect Bot 2.' },
          reasoningSummary: { intent: 'Expose the wolf', confidence: 0.8, keyObservations: ['obs'] },
        },
      }),
      NAME_INDEX,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]!.kind).toBe('speak');
    expect(lines[0]!.text).toContain('Bot 1');
    expect(lines[0]!.text).toContain('I suspect Bot 2.');
    expect(lines[0]!.sub).toBe('nods slowly');
    expect(lines[1]!.kind).toBe('reason');
    expect(lines[1]!.text).toContain('Expose the wolf');
  });

  it('agent.action_received speak without reasoningSummary → one speak line only', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p1',
          action: { type: 'speak', playerId: 'p1', inner: '', performance: 'shrugs', speech: 'No comment.' },
        },
      }),
      NAME_INDEX,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe('speak');
    expect(lines[0]!.sub).toBe('shrugs');
  });

  it('returns empty array for night-phase events', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: { phase: 'night-werewolf-vote', action: { type: 'werewolf-vote' } },
      }),
      NAME_INDEX,
    );
    expect(lines).toHaveLength(0);
  });

  // ISSUE-003 — hunter-shoot used to fall through to the generic "<name> 行动"
  // fallback so the moment of the kill carried no information about who was
  // shot. Surface it explicitly, with a separate copy for the abstain case.
  it('agent.action_received hunter-shoot with target → "🏹 <name> 开枪 → <target>"', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'hunter-shoot',
          playerId: 'p4',
          action: { type: 'hunter-shoot', targetId: 'p7' },
        },
      }),
      NAME_INDEX,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe('system');
    expect(lines[0]?.text).toBe('🏹 Bot 4 开枪 → Bot 7');
  });

  it('agent.action_received hunter-shoot with targetId=null → "🏹 <name> 放弃开枪"', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'hunter-shoot',
          playerId: 'p4',
          action: { type: 'hunter-shoot', targetId: null },
        },
      }),
      NAME_INDEX,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe('system');
    expect(lines[0]?.text).toBe('🏹 Bot 4 放弃开枪');
  });
});
