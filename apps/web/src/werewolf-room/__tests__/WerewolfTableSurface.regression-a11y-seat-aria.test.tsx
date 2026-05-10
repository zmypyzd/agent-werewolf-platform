import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WerewolfTableSurface } from '../WerewolfTableSurface.js';
import { WerewolfPhaseIndicator } from '../WerewolfPhaseIndicator.js';
import { emptyRoomState, type WerewolfRoomState, type SeatVM } from '../werewolfRoomTypes.js';

// Regression: pre-fix, seats rendered as bare <div> with no role / aria-label,
// and the phase indicator was a plain <div> with no aria-live region. Screen
// readers walked each child of a seat tile (P1, ⚔️, Bot 1, speaking…) with no
// top-level identity, and never announced day/night phase transitions at all.
//
// Fix: seat outer div gets role="group" + aria-label that summarises seat
// number, occupant, alive/dead+cause, revealed role (when match ends), and
// speaking state. Phase indicator gets role="status" + aria-live="polite" so
// SR users hear "🌙 夜 1 · WEREWOLVES CHOOSING TARGET" the moment phase
// changes — same window the visual bar updates.
//
// This test pins the contract so a future "let me clean up the JSX"
// refactor doesn't silently strip the attributes.

function makeRunningState(seats: SeatVM[]): WerewolfRoomState {
  const base = emptyRoomState('g-a11y');
  // Pad to 9 seats with empties so SeatCard renders the full ring.
  while (seats.length < 9) {
    const i = seats.length;
    seats.push({
      seatIndex: i,
      playerId: `p${i + 1}`,
      occupant: { kind: 'empty' },
      alive: true,
    });
  }
  return {
    ...base,
    status: 'running',
    currentPhase: 'day-speeches',
    dayNumber: 1,
    seats,
  };
}

describe('WerewolfTableSurface a11y — seat aria-label', () => {
  it('renders role="group" on every seat with the seat number in aria-label', () => {
    const html = renderToStaticMarkup(
      <WerewolfTableSurface state={makeRunningState([])} />,
    );
    // 9 seats, each with role="group"
    const groupMatches = html.match(/role="group"/g) ?? [];
    expect(groupMatches.length).toBe(9);
    // Aria-label leads with seat number (P1..P9). Pick a couple to spot-check.
    expect(html).toContain('aria-label="P1');
    expect(html).toContain('aria-label="P9');
  });

  it('describes an empty seat as "空座位" in aria-label', () => {
    const html = renderToStaticMarkup(
      <WerewolfTableSurface state={makeRunningState([])} />,
    );
    expect(html).toContain('aria-label="P1 · 空座位"');
  });

  it('describes an alive occupant with name + 存活 in aria-label', () => {
    const seats: SeatVM[] = [
      {
        seatIndex: 0,
        playerId: 'p1',
        occupant: { kind: 'npc', agentId: 'a1', displayName: 'Bot 1' },
        alive: true,
      },
    ];
    const html = renderToStaticMarkup(
      <WerewolfTableSurface state={makeRunningState(seats)} />,
    );
    expect(html).toContain('aria-label="P1 · Bot 1 · 存活"');
  });

  it('describes a dead occupant with cause-of-death in aria-label', () => {
    const seats: SeatVM[] = [
      {
        seatIndex: 0,
        playerId: 'p1',
        occupant: { kind: 'npc', agentId: 'a1', displayName: 'Bot 1' },
        alive: false,
        causeOfDeath: 'wolf-kill',
      },
    ];
    const html = renderToStaticMarkup(
      <WerewolfTableSurface state={makeRunningState(seats)} />,
    );
    expect(html).toContain('aria-label="P1 · Bot 1 · ✝ 被狼刀"');
  });

  it('appends 身份 + revealed role once the match has ended', () => {
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
    const html = renderToStaticMarkup(
      <WerewolfTableSurface
        state={{ ...base, status: 'completed', currentPhase: 'completed', seats, winner: 'werewolf' }}
      />,
    );
    expect(html).toContain('aria-label="P1 · Bot 1 · 存活 · 身份: 狼人"');
  });

  it('marks the user-owned seat with "你的 agent" in aria-label', () => {
    const seats: SeatVM[] = [
      {
        seatIndex: 0,
        playerId: 'p1',
        occupant: { kind: 'agent', agentId: 'a1', displayName: 'My Bot', isMine: true },
        alive: true,
      },
    ];
    const html = renderToStaticMarkup(
      <WerewolfTableSurface state={makeRunningState(seats)} />,
    );
    expect(html).toContain('你的 agent');
    // The aria-label tail token, not the existing visible "MINE" pill.
    expect(html).toContain('aria-label="P1 · My Bot · 存活 · 你的 agent"');
  });
});

describe('WerewolfPhaseIndicator a11y — live region', () => {
  it('renders role="status" + aria-live="polite" + aria-atomic="true"', () => {
    const base = emptyRoomState('g');
    const html = renderToStaticMarkup(
      <WerewolfPhaseIndicator
        state={{ ...base, status: 'running', currentPhase: 'night-werewolf-vote', nightNumber: 1 }}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
  });

  it('aria-label contains both the chinese label and english subtitle', () => {
    const base = emptyRoomState('g');
    const html = renderToStaticMarkup(
      <WerewolfPhaseIndicator
        state={{ ...base, status: 'running', currentPhase: 'night-werewolf-vote', nightNumber: 1 }}
      />,
    );
    // Label "🌙 夜 1" plus subtitle "WEREWOLVES CHOOSING TARGET" joined by " · "
    expect(html).toContain('aria-label="🌙 夜 1 · WEREWOLVES CHOOSING TARGET"');
  });
});
