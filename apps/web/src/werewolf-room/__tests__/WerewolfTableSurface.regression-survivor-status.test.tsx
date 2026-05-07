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

// ISSUE-004 — mid-match (status !== 'completed', revealRoles=false), the
// surface used to render every dead seat as "✝ 已淘汰" regardless of cause.
// Now the surface renders distinct copy per causeOfDeath so the 9 seats
// double as a death-cause dashboard. After match-completed (revealRoles
// turns on), seats fall back to the role label as before.
function makeRunningStateWithCauses(): WerewolfRoomState {
  const base = emptyRoomState('g-running');
  const seats: SeatVM[] = [
    {
      seatIndex: 0,
      playerId: 'p1',
      occupant: { kind: 'npc', agentId: 'a1', displayName: 'Bot 1' },
      alive: false,
      causeOfDeath: 'wolf-kill',
    },
    {
      seatIndex: 1,
      playerId: 'p2',
      occupant: { kind: 'npc', agentId: 'a2', displayName: 'Bot 2' },
      alive: false,
      causeOfDeath: 'witch-poison',
    },
    {
      seatIndex: 2,
      playerId: 'p3',
      occupant: { kind: 'npc', agentId: 'a3', displayName: 'Bot 3' },
      alive: false,
      causeOfDeath: 'banishment',
    },
    {
      seatIndex: 3,
      playerId: 'p4',
      occupant: { kind: 'npc', agentId: 'a4', displayName: 'Bot 4' },
      alive: false,
      causeOfDeath: 'hunter-shoot',
    },
  ];
  while (seats.length < 9) {
    const i = seats.length;
    seats.push({
      seatIndex: i,
      playerId: `p${i + 1}`,
      occupant: { kind: 'npc', agentId: `a${i + 1}`, displayName: `Bot ${i + 1}` },
      alive: true,
    });
  }
  return {
    ...base,
    status: 'running',
    currentPhase: 'day-speeches',
    seats,
  };
}

describe('WerewolfTableSurface — cause-of-death copy on dead seats mid-match', () => {
  it('renders ✝ 被狼刀 / ✝ 被毒 / ✝ 被放逐 / ✝ 被开枪 distinctly', () => {
    const html = renderToStaticMarkup(
      <WerewolfTableSurface state={makeRunningStateWithCauses()} />,
    );
    expect(html).toContain('✝ 被狼刀');
    expect(html).toContain('✝ 被毒');
    expect(html).toContain('✝ 被放逐');
    expect(html).toContain('✝ 被开枪');
  });

  it('falls back to ✝ 已淘汰 for a dead seat with no causeOfDeath', () => {
    const base = emptyRoomState('g-fallback');
    const seats: SeatVM[] = base.seats.map((s, i) =>
      i === 0
        ? {
            seatIndex: 0,
            playerId: 'p1',
            occupant: { kind: 'npc', agentId: 'a1', displayName: 'Bot 1' },
            alive: false,
            // No causeOfDeath set — older replay events without the field
            // must still render something.
          }
        : {
            ...s,
            occupant: { kind: 'npc', agentId: `a${i + 1}`, displayName: `Bot ${i + 1}` },
          },
    );
    const html = renderToStaticMarkup(
      <WerewolfTableSurface state={{ ...base, status: 'running', currentPhase: 'day-speeches', seats }} />,
    );
    expect(html).toContain('✝ 已淘汰');
  });

  // ISSUE-005 — spectator broadcast view: when match.started has populated
  // revealedRole on a still-running match, role badges go live on every
  // seat. Dead seats keep showing cause-of-death (the more dynamic info);
  // role is conveyed by the badge emoji on top of the card.
  it('mid-match with revealedRole on every seat: living seats render role label, dead seats keep cause-of-death', () => {
    const base = emptyRoomState('g-spectator-live');
    const seats: SeatVM[] = [
      // Living wolf — role label takes over from "waiting"
      {
        seatIndex: 0,
        playerId: 'p1',
        occupant: { kind: 'npc', agentId: 'a1', displayName: 'Bot 1' },
        alive: true,
        revealedRole: 'werewolf',
        revealedSide: 'werewolf',
      },
      // Dead wolf — cause-of-death wins, NOT "✝ 狼人"
      {
        seatIndex: 1,
        playerId: 'p2',
        occupant: { kind: 'npc', agentId: 'a2', displayName: 'Bot 2' },
        alive: false,
        causeOfDeath: 'banishment',
        revealedRole: 'werewolf',
        revealedSide: 'werewolf',
      },
      // Living seer
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
        alive: true,
        revealedRole: 'villager',
        revealedSide: 'good',
      });
    }
    const html = renderToStaticMarkup(
      <WerewolfTableSurface
        state={{
          ...base,
          status: 'running',
          currentPhase: 'day-speeches',
          seats,
        }}
      />,
    );
    // Living wolf shows the 狼人 label, not the lobby placeholder.
    expect(html).toContain('狼人');
    // Living seer shows 预言家.
    expect(html).toContain('预言家');
    // Dead wolf prefers cause-of-death copy over the role label.
    expect(html).toContain('✝ 被放逐');
    // No "waiting" leak from the lobby copy now that revealRoles is live.
    const waitingMatches = html.match(/>waiting</g) ?? [];
    expect(waitingMatches).toHaveLength(0);
  });

  it('cause-of-death wins over revealedRole on dead seats, even post-match', () => {
    // ISSUE-005 follow-up: once spectator broadcast view (revealedRole on
    // every seat) ships, the dead-seat priority unifies across modes —
    // cause-of-death always wins because it's the freshest, most-dynamic
    // info; the role is still conveyed via the badge emoji on top of the
    // card so nothing is lost. This replaces the earlier ISSUE-004
    // assertion "post-match: role wins over cause", which only made sense
    // when revealedRole was a post-match-only signal.
    const base = emptyRoomState('g-completed-with-cause');
    const seats: SeatVM[] = base.seats.map((s, i) =>
      i === 0
        ? {
            seatIndex: 0,
            playerId: 'p1',
            occupant: { kind: 'npc', agentId: 'a1', displayName: 'Bot 1' },
            alive: false,
            causeOfDeath: 'wolf-kill',
            revealedRole: 'witch',
            revealedSide: 'good',
          }
        : {
            ...s,
            occupant: { kind: 'npc', agentId: `a${i + 1}`, displayName: `Bot ${i + 1}` },
            alive: false,
            causeOfDeath: 'banishment',
            revealedRole: 'villager',
            revealedSide: 'good',
          },
    );
    const html = renderToStaticMarkup(
      <WerewolfTableSurface state={{ ...base, status: 'completed', currentPhase: 'completed', seats, winner: 'werewolf' }} />,
    );
    expect(html).toContain('✝ 被狼刀');
    expect(html).toContain('✝ 被放逐');
    expect(html).not.toContain('✝ 女巫');
    expect(html).not.toContain('✝ 村民');
  });

  it('revealedRole falls back to "✝ {role}" on a dead seat without causeOfDeath (legacy / schema-failed event)', () => {
    const base = emptyRoomState('g-fallback-to-role');
    const seats: SeatVM[] = base.seats.map((s, i) =>
      i === 0
        ? {
            seatIndex: 0,
            playerId: 'p1',
            occupant: { kind: 'npc', agentId: 'a1', displayName: 'Bot 1' },
            alive: false,
            // No causeOfDeath — legacy event that pre-dates the cause wiring.
            revealedRole: 'witch',
            revealedSide: 'good',
          }
        : {
            ...s,
            occupant: { kind: 'npc', agentId: `a${i + 1}`, displayName: `Bot ${i + 1}` },
            alive: true,
            revealedRole: 'villager',
            revealedSide: 'good',
          },
    );
    const html = renderToStaticMarkup(
      <WerewolfTableSurface state={{ ...base, status: 'running', currentPhase: 'day-speeches', seats }} />,
    );
    expect(html).toContain('✝ 女巫');
  });
});
