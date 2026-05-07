import { describe, it, expect } from 'vitest';
import { normalizeWerewolfReplayEvent } from '../normalizeWerewolfReplayEvent.js';
import type { WerewolfReplayEvent } from '../werewolfRoomTypes.js';

// Regression: ISSUE-001 — when the day's vote flops (every PK round ties /
// no strict majority), the orchestrator marks the next phase.changed with
// dayVoteOutcome:'no-banishment'. The normalizer must surface a "🕊️ 第 N
// 天投票流产，今日无人被放逐" line so spectators see WHY the match jumped
// straight from voting into the next night.

const NAME_INDEX: Record<string, string> = {};

function makeEvent(partial: Partial<WerewolfReplayEvent>): WerewolfReplayEvent {
  return {
    eventId: 'eid-no-ban',
    gameId: 'g',
    sequence: 0,
    eventType: 'phase.changed',
    timestamp: 0,
    data: {},
    ...partial,
  } as WerewolfReplayEvent;
}

describe('normalizeWerewolfReplayEvent — no-banishment outcome', () => {
  it('phase.changed with dayVoteOutcome=no-banishment pushes a "🕊️ 第 N 天投票流产" line before the night banner', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        data: {
          phase: 'night-werewolf-vote',
          nightNumber: 2,
          dayNumber: 1,
          dayVoteOutcome: 'no-banishment',
        },
      }),
      NAME_INDEX,
    );
    // Expect a flopped-vote system line plus the night-2 banner.
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const flopped = lines.find((l) => l.text.includes('投票流产'));
    expect(flopped).toBeDefined();
    expect(flopped!.kind).toBe('system');
    expect(flopped!.text).toBe('🕊️ 第 1 天投票流产，今日无人被放逐');
    // The flopped line precedes the night banner so users read events in
    // causal order.
    const floppedIdx = lines.findIndex((l) => l.text.includes('投票流产'));
    const nightIdx = lines.findIndex((l) => l.kind === 'phase-night');
    expect(nightIdx).toBeGreaterThan(floppedIdx);
  });

  it('phase.changed without dayVoteOutcome does NOT emit the flopped line', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        data: {
          phase: 'night-werewolf-vote',
          nightNumber: 2,
          dayNumber: 1,
        },
      }),
      NAME_INDEX,
    );
    const flopped = lines.find((l) => l.text.includes('投票流产'));
    expect(flopped).toBeUndefined();
  });

  it('PK revote (phase=day-vote, pkRound>=1) does NOT emit the flopped line and does emit the PK line', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        data: {
          phase: 'day-vote',
          nightNumber: 1,
          dayNumber: 1,
          pkRound: 1,
        },
      }),
      NAME_INDEX,
    );
    const flopped = lines.find((l) => l.text.includes('投票流产'));
    expect(flopped).toBeUndefined();
    // Track the PK line by the post-ISSUE-006 wording.
    const pk = lines.find((l) => l.text.includes('PK 投票'));
    expect(pk).toBeDefined();
  });
});
