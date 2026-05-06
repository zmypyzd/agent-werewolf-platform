import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WerewolfTableSurface } from '../WerewolfTableSurface.js';
import { emptyRoomState, type WerewolfRoomState, type SeatVM } from '../werewolfRoomTypes.js';

// Regression: ISSUE-006 — Once a match ended, dead players correctly displayed
// their role (✝ 女巫 / ✝ 村民), but living players still read "waiting" from
// the lobby. The post-match scoreboard had the winning wolves labeled
// "waiting" next to the dead villagers' role labels — confusing at best,
// information loss at worst.
// Found by /qa on 2026-05-06.
// Report: .gstack/qa-reports/qa-report-localhost-2026-05-06.md

function makeCompletedState(): WerewolfRoomState {
  const base = emptyRoomState('g-completed');
  const seats: SeatVM[] = [
    {
      seatIndex: 0,
      playerId: 'p1',
      occupant: { kind: 'npc', agentId: 'a1', displayName: 'Bot 1' },
      alive: true,
      revealedRole: 'werewolf',
      revealedSide: 'werewolf',
    },
    {
      seatIndex: 1,
      playerId: 'p2',
      occupant: { kind: 'npc', agentId: 'a2', displayName: 'Bot 2' },
      alive: false,
      revealedRole: 'witch',
      revealedSide: 'good',
    },
    {
      seatIndex: 2,
      playerId: 'p3',
      occupant: { kind: 'npc', agentId: 'a3', displayName: 'Bot 3' },
      alive: true,
      revealedRole: 'seer',
      revealedSide: 'good',
    },
  ];
  while (seats.length < 9) {
    const i = seats.length;
    seats.push({
      seatIndex: i,
      playerId: `p${i + 1}`,
      occupant: { kind: 'npc', agentId: `a${i + 1}`, displayName: `Bot ${i + 1}` },
      alive: false,
      revealedRole: 'villager',
      revealedSide: 'good',
    });
  }
  return {
    ...base,
    status: 'completed',
    currentPhase: 'completed',
    seats,
    winner: 'werewolf',
  };
}

describe('WerewolfTableSurface — survivor status after match completes', () => {
  it('shows the role label on surviving seats, not "waiting"', () => {
    const html = renderToStaticMarkup(<WerewolfTableSurface state={makeCompletedState()} />);
    // Surviving wolf (Bot 1) — should show 狼人, not waiting
    expect(html).toContain('狼人');
    // Surviving seer (Bot 3) — should show 预言家
    expect(html).toContain('预言家');
    // Dead witch (Bot 2) — already worked, kept here as a guard
    expect(html).toContain('✝ 女巫');
  });

  it('does NOT show "waiting" for any seat once revealRoles is active', () => {
    const html = renderToStaticMarkup(<WerewolfTableSurface state={makeCompletedState()} />);
    // The substring "waiting" must not appear anywhere in the rendered seats.
    // (The pre-fix output had `waiting` for every survivor.)
    const waitingMatches = html.match(/>waiting</g) ?? [];
    expect(waitingMatches).toHaveLength(0);
  });
});
