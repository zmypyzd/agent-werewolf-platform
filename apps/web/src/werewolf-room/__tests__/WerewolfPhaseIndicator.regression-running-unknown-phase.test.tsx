import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WerewolfPhaseIndicator } from '../WerewolfPhaseIndicator.js';
import { emptyRoomState, type WerewolfRoomState } from '../werewolfRoomTypes.js';

// Regression: phase indicator showed '等待开局 / WAITING FOR PLAYERS' for a
// late-joining spectator on a clearly-running match. Discovered by /qa on
// 2026-05-09 against agent-werewolf-platform.vercel.app.
//
// Root cause: the SSE stream has no backlog (apps/api/src/routes/werewolf-stream.ts
// — "No preface for now — late spectators only get events from the moment
// they connect"). The lobby-poll response delivers `status: 'running'` but
// no phase metadata, so `currentPhase` stays at its initial empty value and
// the indicator falls through to the pre-match copy.
//
// Fix: when status === 'running' but neither a day-* nor night-* phase has
// been observed yet, render '对局进行中 / GAME IN PROGRESS' instead.

function runningWithUnknownPhase(): WerewolfRoomState {
  const base = emptyRoomState('g1');
  return { ...base, status: 'running' };
}

describe('WerewolfPhaseIndicator — running with unknown phase', () => {
  it('renders 对局进行中 instead of 等待开局 when status is running but no phase events landed', () => {
    const state = runningWithUnknownPhase();
    const html = renderToStaticMarkup(<WerewolfPhaseIndicator state={state} />);
    expect(html).toContain('对局进行中');
    expect(html).toContain('GAME IN PROGRESS');
    expect(html).not.toContain('等待开局');
    expect(html).not.toContain('WAITING FOR PLAYERS');
  });

  it('does not apply the is-waiting class once status is running', () => {
    const state = runningWithUnknownPhase();
    const html = renderToStaticMarkup(<WerewolfPhaseIndicator state={state} />);
    expect(html).not.toContain('is-waiting');
  });

  it('still shows 等待开局 / WAITING FOR PLAYERS while status is waiting', () => {
    const state = { ...emptyRoomState('g1'), currentPhase: 'pre-match' as const };
    const html = renderToStaticMarkup(<WerewolfPhaseIndicator state={state} />);
    expect(html).toContain('等待开局');
    expect(html).toContain('WAITING FOR PLAYERS');
  });

  it('night phase wins over the running-unknown fallback', () => {
    const base = emptyRoomState('g1');
    const state: WerewolfRoomState = {
      ...base,
      status: 'running',
      currentPhase: 'night-werewolf-vote',
      nightNumber: 1,
    };
    const html = renderToStaticMarkup(<WerewolfPhaseIndicator state={state} />);
    expect(html).toContain('🌙 夜 1');
    expect(html).not.toContain('对局进行中');
  });

  it('day phase wins over the running-unknown fallback', () => {
    const base = emptyRoomState('g1');
    const state: WerewolfRoomState = {
      ...base,
      status: 'running',
      currentPhase: 'day-vote',
      dayNumber: 2,
    };
    const html = renderToStaticMarkup(<WerewolfPhaseIndicator state={state} />);
    expect(html).toContain('☀️ 天 2');
    expect(html).not.toContain('对局进行中');
  });
});
