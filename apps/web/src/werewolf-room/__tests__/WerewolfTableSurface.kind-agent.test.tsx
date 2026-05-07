import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { WerewolfTableSurface } from '../WerewolfTableSurface.js';
import { emptyRoomState, type WerewolfRoomState, type SeatVM } from '../werewolfRoomTypes.js';

// D2=A — kind:'agent' renders displayName like kind:'npc' (no '???' fallback)
// and adds an AGENT tag. D5=A — when seat.occupant.isMine===true the MINE pill
// renders; without isMine (i.e., spectator / non-owner view) the pill is
// absent. These are the load-bearing visual-isolation invariants from the UI
// design plan; pin them so a future occupant-shape change can't silently
// regress them.

function makeStateWithSeat(seat: SeatVM): WerewolfRoomState {
  const base = emptyRoomState('test-game');
  const seats = base.seats.map((s, i) => (i === seat.seatIndex ? seat : s));
  return { ...base, status: 'waiting', seats };
}

describe('WerewolfTableSurface kind:"agent" rendering', () => {
  it('renders displayName for kind:"agent" seat (not "???")', () => {
    const seat: SeatVM = {
      seatIndex: 0,
      playerId: 'p1',
      occupant: { kind: 'agent', agentId: 'agent-p1', displayName: 'gpt-werewolf-v1' },
      alive: true,
    };
    const html = renderToString(<WerewolfTableSurface state={makeStateWithSeat(seat)} />);
    expect(html).toContain('gpt-werewolf-v1');
    // The AGENT tag distinguishes external agent seats from NPC seats.
    expect(html).toContain('AGENT');
    // No '???' fallback for kind:'agent' (that was the pre-feature legacy
    // path before this PR).
    expect(html).not.toContain('???');
  });

  it('renders MINE pill ONLY when isMine===true on an agent seat', () => {
    const mineSeat: SeatVM = {
      seatIndex: 0,
      playerId: 'p1',
      occupant: {
        kind: 'agent',
        agentId: 'agent-p1',
        displayName: 'my-agent',
        isMine: true,
      },
      alive: true,
    };
    const otherSeat: SeatVM = {
      seatIndex: 0,
      playerId: 'p1',
      occupant: { kind: 'agent', agentId: 'agent-p1', displayName: 'their-agent' },
      alive: true,
    };
    const ownerHtml = renderToString(
      <WerewolfTableSurface state={makeStateWithSeat(mineSeat)} />,
    );
    const spectatorHtml = renderToString(
      <WerewolfTableSurface state={makeStateWithSeat(otherSeat)} />,
    );
    expect(ownerHtml).toContain('MINE');
    expect(spectatorHtml).not.toContain('MINE');
  });

  it('SPECTATOR-NO-LEAK: ownerUserId / agentConfigId never appear in rendered HTML for any agent seat', () => {
    // Defense-in-depth: even if a regression slipped owner fields into the
    // SeatVM at the type level (TS would catch most, but a server with a
    // bad projection could ship them as JSON the reducer trustingly stores),
    // the renderer must NEVER stringify those secrets into the DOM.
    const seat = {
      seatIndex: 0,
      playerId: 'p1',
      occupant: {
        kind: 'agent' as const,
        agentId: 'agent-p1',
        displayName: 'rogue-agent',
        // Type-level forbidden fields — coerce in for the regression check.
        ...({
          ownerUserId: 'leaked-owner-id-DO-NOT-RENDER',
          agentConfigId: 'leaked-cfg-id-DO-NOT-RENDER',
        } as object),
      },
      alive: true,
    } as unknown as SeatVM;
    const html = renderToString(<WerewolfTableSurface state={makeStateWithSeat(seat)} />);
    expect(html).not.toContain('leaked-owner-id-DO-NOT-RENDER');
    expect(html).not.toContain('leaked-cfg-id-DO-NOT-RENDER');
  });

  it('empty seat shows "邀请..." entry button when an invite handler is provided', () => {
    const html = renderToString(
      <WerewolfTableSurface state={emptyRoomState('g')} onInvite={async () => {}} />,
    );
    // 9 empty seats × 1 button each
    const matches = html.match(/邀请\.\.\./g) ?? [];
    expect(matches.length).toBe(9);
  });
});
