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

describe('normalizeWerewolfReplayEvent — eliminations and PK rounds', () => {
  it('day-announce phase.changed with eliminated[] emits one system line per death + the day banner', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: {
          phase: 'day-announce',
          dayNumber: 2,
          eliminated: [
            { playerId: 'p5', cause: 'wolf-kill' },
            { playerId: 'p2', cause: 'witch-poison' },
          ],
        },
      }),
      NAME_INDEX,
    );
    // 2 deaths + day banner
    expect(lines).toHaveLength(3);
    expect(lines[0]?.kind).toBe('system');
    expect(lines[0]?.text).toContain('Bot 5');
    expect(lines[0]?.text).toContain('夜里被狼刀');
    expect(lines[1]?.kind).toBe('system');
    expect(lines[1]?.text).toContain('Bot 2');
    expect(lines[1]?.text).toContain('女巫毒杀');
    expect(lines[2]?.kind).toBe('phase-day');
    expect(lines[2]?.text).toContain('天 2');
  });

  it('day-resolve banishment surfaces as a death system line', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: {
          phase: 'night-werewolf-vote',
          nightNumber: 2,
          eliminated: [{ playerId: 'p9', cause: 'banishment' }],
        },
      }),
      NAME_INDEX,
    );
    const death = lines.find((l) => l.kind === 'system' && l.text.includes('Bot 9'));
    expect(death).toBeDefined();
    expect(death!.text).toContain('白天投票放逐');
  });

  it('hunter-shoot cause is labeled correctly', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: {
          phase: 'day-speeches',
          dayNumber: 1,
          eliminated: [{ playerId: 'p3', cause: 'hunter-shoot' }],
        },
      }),
      NAME_INDEX,
    );
    const death = lines.find((l) => l.text.includes('Bot 3'));
    expect(death).toBeDefined();
    expect(death!.text).toContain('猎人开枪');
  });

  it('day-vote with pkRound=1 emits "进入第 1 轮 PK 投票" and SUPPRESSES the day banner', () => {
    // ISSUE-006 — pkRound is now treated as a 1-based PK index in copy.
    // Old text was "进入第 2 轮决战投票" at pkRound=1, which was confusing
    // because spectators had already seen the regular day-1 vote round
    // (no PK label) and wondered where "第 1 轮决战投票" went. New copy
    // drops both the +1 and the "决战" word: "第 ${pkRound} 轮 PK 投票".
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1, pkRound: 1 },
      }),
      NAME_INDEX,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe('system');
    expect(lines[0]?.text).toBe('⚖️ 票数相同，进入第 1 轮 PK 投票');
    // Verify no double day banner during a PK revote
    expect(lines.find((l) => l.kind === 'phase-day')).toBeUndefined();
  });

  it('PK round number scales linearly: pkRound=2 → "进入第 2 轮 PK 投票", pkRound=3 → "进入第 3 轮 PK 投票"', () => {
    for (const pk of [2, 3]) {
      const lines = normalizeWerewolfReplayEvent(
        makeEvent({
          eventType: 'phase.changed',
          data: { phase: 'day-vote', dayNumber: 1, pkRound: pk },
        }),
        NAME_INDEX,
      );
      expect(lines[0]?.text).toBe(`⚖️ 票数相同，进入第 ${pk} 轮 PK 投票`);
    }
  });

  it('day-vote with pkRound=0 (or missing) emits the normal day banner', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
      NAME_INDEX,
    );
    const banner = lines.find((l) => l.kind === 'phase-day');
    expect(banner).toBeDefined();
    expect(lines.find((l) => l.text.includes('PK') || l.text.includes('决战'))).toBeUndefined();
  });

  it('phase.changed with no eliminated and no pkRound emits the normal phase banner only (back-compat)', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 1 },
      }),
      NAME_INDEX,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe('phase-night');
  });
});
