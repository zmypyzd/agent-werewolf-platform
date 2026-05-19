import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WerewolfOmniscientTable,
  type OmniscientRolesMap,
} from '../WerewolfOmniscientTable.js';
import type { SeatVM } from '../werewolfRoomTypes.js';

// Smoke test for the omniscient-mode table — guards that the component
// renders nine seats in the 1+3+3+2 slot system, surfaces role classes
// from the omniscient map, and stamps the speaker / dead modifiers.
// Approved direction lives in
// /Users/zmy/.gstack/projects/5-4-claude/designs/werewolf-twitch-livestream-20260518/approved.json
//
// Uses renderToStaticMarkup to match the repo convention for werewolf-room
// component tests (no jsdom, no @testing-library/react).

function seat(index: number, name: string, alive = true): SeatVM {
  return {
    seatIndex: index,
    playerId: `p${index + 1}`,
    occupant: { kind: 'agent', agentId: `agent-${index}`, displayName: name },
    alive,
  };
}

const SEATS: readonly SeatVM[] = [
  seat(0, 'Nova-1'),
  seat(1, 'Echo-2'),
  seat(2, 'Echo-3'),
  seat(3, 'Atlas-3'),
  { ...seat(4, 'Sigma-5', false), causeOfDeath: 'banishment', revealedRole: 'werewolf', revealedSide: 'werewolf' },
  seat(5, 'Vector-7'),
  seat(6, 'Quanta-4'),
  seat(7, 'Pulse-6'),
  seat(8, 'Nimbus-8'),
];

const OMNI: OmniscientRolesMap = {
  0: { role: 'villager', side: 'good' },
  1: { role: 'werewolf', side: 'werewolf' },
  2: { role: 'seer', side: 'good' },
  3: { role: 'werewolf', side: 'werewolf' },
  4: { role: 'werewolf', side: 'werewolf' },
  5: { role: 'witch', side: 'good' },
  6: { role: 'villager', side: 'good' },
  7: { role: 'hunter', side: 'good' },
  8: { role: 'villager', side: 'good' },
};

describe('WerewolfOmniscientTable', () => {
  it('renders 9 seat cards with slot classes is-p1 through is-p9', () => {
    const html = renderToStaticMarkup(
      <WerewolfOmniscientTable
        seats={SEATS}
        speakingActor="p3"
        omniscientRoles={OMNI}
        currentPhaseTag="night-witch · observer view"
      />,
    );
    // Nine ww-omni-card occurrences, each tagged with its is-pN slot.
    expect(html.match(/class="[^"]*\bww-omni-card\b/g)?.length).toBe(9);
    for (const slot of ['is-p1', 'is-p2', 'is-p3', 'is-p4', 'is-p5', 'is-p6', 'is-p7', 'is-p8', 'is-p9']) {
      expect(html).toContain(slot);
    }
    expect(html).toContain('night-witch · observer view');
  });

  it('stamps role classes from the omniscient map', () => {
    const html = renderToStaticMarkup(
      <WerewolfOmniscientTable seats={SEATS} omniscientRoles={OMNI} />,
    );
    expect(html).toContain('is-role-villager');
    expect(html).toContain('is-role-werewolf');
    expect(html).toContain('is-role-seer');
    expect(html).toContain('is-role-witch');
    expect(html).toContain('is-role-hunter');
    // Role-name pills carry the localized label.
    expect(html).toContain('VILLAGER');
    expect(html).toContain('WEREWOLF');
    expect(html).toContain('SEER');
    expect(html).toContain('WITCH');
    expect(html).toContain('HUNTER');
  });

  it('applies is-speaking + ON AIR badge to the speaking actor', () => {
    const html = renderToStaticMarkup(
      <WerewolfOmniscientTable
        seats={SEATS}
        speakingActor="p3"
        omniscientRoles={OMNI}
      />,
    );
    // The speaker (seat index 2 → is-p3) carries both classes plus the air badge.
    expect(html).toMatch(/is-p3[^"]*is-speaking|is-speaking[^"]*is-p3/);
    expect(html).toContain('ww-omni-air-badge');
    expect(html).toContain('ON AIR');
  });

  it('applies is-dead + reveal label to the dead seat', () => {
    const html = renderToStaticMarkup(
      <WerewolfOmniscientTable seats={SEATS} omniscientRoles={OMNI} />,
    );
    // Sigma-5 sits at seatIndex 4 → is-p5; dead state carries the slash and reveal label.
    expect(html).toMatch(/is-p5[^"]*is-dead|is-dead[^"]*is-p5/);
    expect(html).toContain('ww-omni-death-cut');
    expect(html).toContain('ww-omni-death-label');
    expect(html).toContain('WEREWOLF · REVEALED');
    expect(html).toContain('banishment');
  });

  it('falls back to revealedRole when no omniscient map is provided', () => {
    const html = renderToStaticMarkup(
      <WerewolfOmniscientTable seats={SEATS} />,
    );
    // Sigma-5 has revealedRole='werewolf', so the role class still appears.
    expect(html).toContain('is-role-werewolf');
    // The other eight seats have no revealedRole → no other role classes
    // should show up. Verify only the death-revealed slot carries a role.
    const roleClassMatches = html.match(/is-role-\w+/g) ?? [];
    expect(roleClassMatches.every((c) => c === 'is-role-werewolf')).toBe(true);
  });

  it('renders empty seats (occupant.kind === "empty") without crashing', () => {
    // Pre-match the WerewolfRoomPage seeds 9 seats with `occupant.kind: "empty"`
    // before any agent is invited (see emptyRoomState in werewolfRoomTypes.ts).
    // The omniscient table must survive this state — historically the
    // original WerewolfTableSurface guarded for this; we keep parity.
    const emptySeats: SeatVM[] = Array.from({ length: 9 }, (_, i) => ({
      seatIndex: i,
      playerId: `p${i + 1}`,
      occupant: { kind: 'empty' },
      alive: true,
    }));
    const html = renderToStaticMarkup(
      <WerewolfOmniscientTable seats={emptySeats} omniscientRoles={OMNI} />,
    );
    // Nine slots still rendered; placeholder name surface is `Seat N`.
    expect(html.match(/class="[^"]*\bww-omni-card\b/g)?.length).toBe(9);
    expect(html).toContain('Seat 1');
    expect(html).toContain('Seat 9');
    // Role classes still carry through from the omniscient map even when
    // no agent is seated — the spectator can preview the planned lineup.
    expect(html).toContain('is-role-villager');
    expect(html).toContain('is-role-seer');
  });

  it('stamps is-thinking on the thinking actor (and not the speaker)', () => {
    // The reducer sets `thinkingActor` on `agent.action_requested` and clears
    // it on `action_received`. The omniscient table surfaces this via the
    // is-thinking class + THINKING badge so spectators see who is mulling.
    const html = renderToStaticMarkup(
      <WerewolfOmniscientTable
        seats={SEATS}
        thinkingActor="p6"
        speakingActor="p3"
        omniscientRoles={OMNI}
      />,
    );
    // P6 (witch) carries is-thinking with THINKING badge.
    expect(html).toMatch(/is-p6[^"]*is-thinking|is-thinking[^"]*is-p6/);
    expect(html).toContain('THINKING');
    // The speaker (P3) keeps is-speaking and does NOT also receive is-thinking.
    expect(html).toMatch(/is-p3[^"]*is-speaking|is-speaking[^"]*is-p3/);
    expect(html).not.toMatch(/is-p3[^"]*is-thinking|is-thinking[^"]*is-p3/);
  });
});
