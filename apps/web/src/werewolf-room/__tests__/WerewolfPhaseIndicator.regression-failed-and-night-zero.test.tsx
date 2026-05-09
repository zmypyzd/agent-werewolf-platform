import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WerewolfPhaseIndicator } from '../WerewolfPhaseIndicator.js';
import { emptyRoomState, type WerewolfRoomState } from '../werewolfRoomTypes.js';

// Two regressions in one file:
//
// (a) status='failed' before any phase.changed lands → label='异常终止' but
//     subtitle still came from PHASE_SUBTITLES['pre-match'] = 'WAITING FOR
//     PLAYERS'. The two strings contradict each other (we just said the
//     match died, then say we're waiting for players to join). The fix
//     pins the subtitle to a fixed 'MATCH FAILED' whenever status==='failed'.
//
// (b) emptyRoomState seeds nightNumber/dayNumber to 0. If a night-/day-
//     prefixed currentPhase arrives before phase.changed has populated a
//     real number, the indicator rendered "🌙 夜 0" / "☀️ 天 0" — there
//     is no round 0 in the game. Same flavor as the night-fold "夜 0" bug
//     fixed earlier in the reducer (see overnight-qa/night-fold-undefined-
//     number); the indicator had the same exposure. Now falls back to the
//     unnumbered "对局进行中 / GAME IN PROGRESS" copy until a real round
//     number lands.

describe('WerewolfPhaseIndicator — failed + nightNumber=0 regressions', () => {
  it('failed pre-match shows "异常终止" with "MATCH FAILED" subtitle, not the pre-match copy', () => {
    const state: WerewolfRoomState = {
      ...emptyRoomState('g1'),
      status: 'failed',
      failureReason: 'agent crashed',
    };
    const html = renderToStaticMarkup(<WerewolfPhaseIndicator state={state} />);
    expect(html).toContain('异常终止');
    expect(html).toContain('MATCH FAILED');
    // The contradictory pre-match subtitle must NOT appear alongside
    // "异常终止".
    expect(html).not.toContain('WAITING FOR PLAYERS');
  });

  it('failed mid-match still surfaces MATCH FAILED, not the underlying phase subtitle', () => {
    const state: WerewolfRoomState = {
      ...emptyRoomState('g1'),
      status: 'failed',
      currentPhase: 'night-werewolf-vote',
      nightNumber: 3,
      failureReason: 'orchestrator deadlock',
    };
    const html = renderToStaticMarkup(<WerewolfPhaseIndicator state={state} />);
    expect(html).toContain('异常终止');
    expect(html).toContain('MATCH FAILED');
    // The night-werewolf-vote subtitle must not show up.
    expect(html).not.toContain('WEREWOLVES CHOOSING TARGET');
  });

  it('night phase with nightNumber=0 falls back to 对局进行中 (no "夜 0")', () => {
    const state: WerewolfRoomState = {
      ...emptyRoomState('g1'),
      status: 'running',
      currentPhase: 'night-werewolf-vote',
      // nightNumber stays at the emptyRoomState sentinel of 0.
    };
    const html = renderToStaticMarkup(<WerewolfPhaseIndicator state={state} />);
    expect(html).not.toMatch(/夜\s*0/);
    expect(html).toContain('对局进行中');
  });

  it('day phase with dayNumber=0 falls back to 对局进行中 (no "天 0")', () => {
    const state: WerewolfRoomState = {
      ...emptyRoomState('g1'),
      status: 'running',
      currentPhase: 'day-speeches',
      // dayNumber stays at the emptyRoomState sentinel of 0.
    };
    const html = renderToStaticMarkup(<WerewolfPhaseIndicator state={state} />);
    expect(html).not.toMatch(/天\s*0/);
    expect(html).toContain('对局进行中');
  });

  it('once nightNumber=1 lands, the numbered copy renders normally', () => {
    const state: WerewolfRoomState = {
      ...emptyRoomState('g1'),
      status: 'running',
      currentPhase: 'night-werewolf-vote',
      nightNumber: 1,
    };
    const html = renderToStaticMarkup(<WerewolfPhaseIndicator state={state} />);
    expect(html).toContain('🌙 夜 1');
    expect(html).not.toContain('对局进行中');
  });
});
