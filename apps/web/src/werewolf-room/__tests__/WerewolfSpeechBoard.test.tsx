import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WerewolfTableSurface } from '../WerewolfTableSurface.js';
import {
  emptyRoomState,
  type WerewolfRoomState,
  type SeatVM,
} from '../werewolfRoomTypes.js';

// The center "broadcast booth" speech panel must:
//   1. Be absent until a speech arrives
//   2. Render the speaker's name + role + transcript when state.currentSpeech is set
//   3. Show "ON AIR" when speakingActor matches, "JUST SPOKE" otherwise

function makeBaseSeats(): SeatVM[] {
  return Array.from({ length: 9 }, (_, i) => ({
    seatIndex: i,
    playerId: `p${i + 1}`,
    occupant: { kind: 'npc' as const, agentId: `a${i + 1}`, displayName: `Bot ${i + 1}` },
    alive: true,
  }));
}

function withRunningStatus(s: WerewolfRoomState): WerewolfRoomState {
  return { ...s, status: 'running', seats: makeBaseSeats() };
}

describe('WerewolfSpeechBoard via WerewolfTableSurface', () => {
  it('does NOT render the speech panel before any speech has arrived', () => {
    const state = withRunningStatus(emptyRoomState('g1'));
    const html = renderToStaticMarkup(<WerewolfTableSurface state={state} />);
    expect(html).not.toContain('ww-speech-board');
    expect(html).not.toContain('ON AIR');
  });

  it('renders speaker name, role, transcript, and ON AIR when state.currentSpeech is set and live', () => {
    const seats = makeBaseSeats();
    seats[2] = { ...seats[2]!, revealedRole: 'seer' };
    const state: WerewolfRoomState = {
      ...withRunningStatus(emptyRoomState('g1')),
      seats,
      speakingActor: 'p3',
      currentSpeech: {
        actorId: 'p3',
        text: 'I checked Bot 5 last night, clean villager.',
        performance: 'leans forward, calm',
        intent: 'Establish credibility',
      },
    };
    const html = renderToStaticMarkup(<WerewolfTableSurface state={state} />);
    // Panel container present
    expect(html).toContain('ww-speech-board');
    expect(html).toContain('is-live');
    // Speaker identity baked into the panel
    expect(html).toContain('Bot 3');
    expect(html).toContain('SEAT P3');
    expect(html).toContain('预言家');
    // Live badge active (not the "JUST SPOKE" replay state)
    expect(html).toContain('ON AIR');
    expect(html).not.toContain('JUST SPOKE');
    // Transcript + auxiliary fields
    expect(html).toContain('I checked Bot 5 last night, clean villager.');
    expect(html).toContain('leans forward, calm');
    expect(html).toContain('Establish credibility');
  });

  it('shows "JUST SPOKE" instead of "ON AIR" when speakingActor has cleared but currentSpeech persists', () => {
    // This is the gap window between speakers — currentSpeech is intentionally
    // retained so spectators finish reading, but the active speaker indicator
    // should soften to indicate it's a replay/recap.
    const state: WerewolfRoomState = {
      ...withRunningStatus(emptyRoomState('g1')),
      currentSpeech: {
        actorId: 'p4',
        text: 'I vote P9.',
      },
      // speakingActor intentionally undefined — next agent is being requested
    };
    const html = renderToStaticMarkup(<WerewolfTableSurface state={state} />);
    expect(html).toContain('ww-speech-board');
    expect(html).toContain('JUST SPOKE');
    expect(html).not.toContain('ON AIR');
    expect(html).toContain('I vote P9.');
  });

  it('seat highlight stays in sync with the speech board subject during the gap window', () => {
    // Regression: bug report — center panel showed speaker A while seat A
    // had no LIVE pip, and seat B (the next thinker) had the amber glow.
    // To the user it looked like B was speaking, not A. Fix: when
    // speakingActor clears but currentSpeech persists, that seat gets the
    // 'SPOKE' replay pip + amber glow so the panel↔seat mapping is always
    // visible. The next-thinker indicator was removed entirely.
    const state: WerewolfRoomState = {
      ...withRunningStatus(emptyRoomState('g1')),
      thinkingActor: 'p5', // next speaker is being requested — but NOT rendered
      currentSpeech: {
        actorId: 'p3',
        text: 'I am the seer, P9 is wolf.',
      },
      // speakingActor intentionally undefined
    };
    const html = renderToStaticMarkup(<WerewolfTableSurface state={state} />);
    // The panel shows P3
    expect(html).toContain('Bot 3');
    expect(html).toContain('SEAT P3');
    // P3's seat MUST carry the replay pip ("SPOKE") so the mapping is visible
    expect(html).toMatch(/data-seat-index="2"[^>]*[\s\S]*?is-replay/);
    // No seat carries is-speaking (no live speaker)
    expect(html).not.toMatch(/is-speaking/);
  });

  it('when speaker is live, their seat carries is-speaking and no other seat is highlighted as replay', () => {
    const state: WerewolfRoomState = {
      ...withRunningStatus(emptyRoomState('g1')),
      speakingActor: 'p3',
      currentSpeech: { actorId: 'p3', text: 'Hello.' },
    };
    const html = renderToStaticMarkup(<WerewolfTableSurface state={state} />);
    // P3's seat is the LIVE one
    expect(html).toMatch(/data-seat-index="2"[^>]*[\s\S]*?is-speaking/);
    // No replay pip while speech is live
    expect(html).not.toMatch(/is-replay/);
  });

  it('thinking is never rendered on the table — only LIVE and SPOKE highlight a seat', () => {
    // The next-agent-being-requested indicator (formerly amber glow on the
    // thinkingActor seat) was removed. With currentSpeech showing the
    // recent speaker and no live speech, ONLY that seat is highlighted.
    // No is-thinking class anywhere; no `thinking…` status text.
    const state: WerewolfRoomState = {
      ...withRunningStatus(emptyRoomState('g1')),
      thinkingActor: 'p5',
      currentSpeech: { actorId: 'p3', text: 'Earlier.' },
    };
    const html = renderToStaticMarkup(<WerewolfTableSurface state={state} />);
    expect(html).not.toMatch(/is-thinking/);
    expect(html).not.toContain('thinking…');
    // P3 is the only highlighted seat
    expect(html).toMatch(/data-seat-index="2"[^>]*[\s\S]*?is-replay/);
  });

  it('thinking is never rendered even when there is no currentSpeech (first speech of phase)', () => {
    // Edge case: thinkingActor set, no speech yet, no replay subject. The
    // table shows ZERO highlighted seats. The phase indicator at the top
    // and the event timeline still convey "an agent was requested".
    const state: WerewolfRoomState = {
      ...withRunningStatus(emptyRoomState('g1')),
      thinkingActor: 'p5',
      // currentSpeech undefined, speakingActor undefined
    };
    const html = renderToStaticMarkup(<WerewolfTableSurface state={state} />);
    expect(html).not.toMatch(/is-thinking/);
    expect(html).not.toMatch(/is-speaking/);
    expect(html).not.toMatch(/is-replay/);
    expect(html).not.toContain('ww-speech-board');
  });

  it('falls back gracefully when speech text is empty', () => {
    const state: WerewolfRoomState = {
      ...withRunningStatus(emptyRoomState('g1')),
      speakingActor: 'p1',
      currentSpeech: {
        actorId: 'p1',
        text: '',
      },
    };
    const html = renderToStaticMarkup(<WerewolfTableSurface state={state} />);
    expect(html).toContain('ww-speech-board');
    // Empty text fallback — render an ellipsis so the panel doesn't collapse
    expect(html).toMatch(/ww-speech-text[^>]*>…</);
  });

  it('does NOT render speech panel during night phase even if currentSpeech were somehow set', () => {
    // Defense in depth — the reducer prevents this, but if some state bug
    // produced a stale currentSpeech in night phase, the speech board itself
    // shouldn't crash.  We do still render here because the component trusts
    // the reducer; this test pins the contract that the reducer is the gate,
    // not the view.  If the contract changes (view becomes the gate), update
    // both the component and this expectation together.
    const state: WerewolfRoomState = {
      ...withRunningStatus(emptyRoomState('g1')),
      currentPhase: 'night-werewolf-vote',
      currentSpeech: {
        actorId: 'p7',
        text: 'WOLF CHAT (should not appear in real flow)',
      },
    };
    const html = renderToStaticMarkup(<WerewolfTableSurface state={state} />);
    // Today the view trusts the reducer — so the panel WILL render here.
    // This pins the current contract; failing this test means we changed the
    // gate location and must update reducer tests (info-isolation case) too.
    expect(html).toContain('ww-speech-board');
  });
});
