// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { WerewolfTableSurface } from '../WerewolfTableSurface.js';
import { emptyRoomState, type WerewolfRoomState, type SeatVM } from '../werewolfRoomTypes.js';

// jsdom doesn't implement ResizeObserver, but `AgentPickerPopover` uses one
// to reposition itself on viewport changes. Stub it as a no-op so popover
// mount doesn't crash the test. The popover's positioning is not what this
// regression test exercises — we only care about focus restoration on
// close. Keep this stub local to the file so it doesn't leak into the
// (default) node-environment tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
}

// Regression: clicking an empty seat's "邀请..." button opens the
// AgentPickerPopover. Before this fix, closing the popover (Escape, click
// outside, or successful invite) left focus on document.body — a keyboard
// user navigating with Tab would land back at the top of the page instead
// of next to the seat they were just acting on. WerewolfTableSurface now
// captures the trigger element via `lastTriggerRef` at open time and
// `.focus()`-es it inside a `requestAnimationFrame` after `setPickerAnchor(null)`,
// so focus restoration is deterministic relative to the popover unmount.
//
// This is also the first interactive web test in the repo — it relies on
// `@vitest-environment jsdom` (file-level directive at top) plus
// `@testing-library/react` for render + fireEvent. Existing SSR-style
// tests still use the default node environment.

function makeWaitingLobby(): WerewolfRoomState {
  const base = emptyRoomState('g-focus-restore');
  const seats: SeatVM[] = [];
  for (let i = 0; i < 9; i++) {
    seats.push({
      seatIndex: i,
      playerId: `p${i + 1}`,
      occupant: { kind: 'empty' },
      alive: true,
    });
  }
  // status='waiting' + currentPhase='pre-match' makes every seat render the
  // invite-empty branch (SeatCard renders the "邀请..." button only when
  // onEmptyClick is provided AND the seat is empty).
  return { ...base, status: 'waiting', currentPhase: 'pre-match', seats };
}

describe('WerewolfTableSurface — popover focus restore (jsdom regression)', () => {
  it('restores focus to the invite button when the popover closes via Escape', async () => {
    const { container } = render(
      <WerewolfTableSurface
        state={makeWaitingLobby()}
        // Both handlers provided so the popover renders. Bodies are no-op
        // because the test does not exercise the invite flow itself; it
        // only opens the popover then closes it.
        onInvite={async () => {}}
        onInviteAgent={async () => {}}
      />,
    );

    // First "邀请..." button on the seat ring. There are 9 of them; the
    // exact index does not matter — focus restoration must apply uniformly.
    const inviteButtons = container.querySelectorAll<HTMLButtonElement>('.ww-seat-invite');
    expect(inviteButtons.length).toBe(9);
    const firstInvite = inviteButtons[0]!;

    // Simulate keyboard focus before the click — a Tab nav would also
    // land here in real usage. Without this, the test could pass simply
    // because the body kept focus; we want to assert the *restore*
    // semantic, not the no-op.
    firstInvite.focus();
    expect(document.activeElement).toBe(firstInvite);

    // Click opens the popover. The button's onClick passes its
    // currentTarget up to lastTriggerRef.
    fireEvent.click(firstInvite);

    // Popover should be in the DOM now. The component listens for Escape
    // via a document-level keydown handler that calls onClose.
    const cancel = document.body.querySelector<HTMLButtonElement>('.ww-agent-picker-cancel');
    expect(cancel).not.toBeNull();
    // In real keyboard usage focus would shift INTO the popover when it
    // opens (browser default for modal-dialog elements, or an explicit
    // autofocus). jsdom's fireEvent.click doesn't move focus on its own,
    // so simulate the focus shift explicitly — without this the focus
    // never leaves the trigger and the test would pass even when the
    // restoration logic is removed.
    cancel!.focus();
    expect(document.activeElement).toBe(cancel);

    // Close via Escape.
    fireEvent.keyDown(document, { key: 'Escape' });

    // The fix defers the focus call to requestAnimationFrame so React has
    // a tick to unmount the popover. Wait one rAF inside an act() so the
    // state flush + the rAF callback both complete before we assert.
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });

    // Popover gone, focus restored to the original trigger.
    expect(document.body.querySelector('.ww-agent-picker-cancel')).toBeNull();
    expect(document.activeElement).toBe(firstInvite);
  });

  it('restores focus to the invite button when the popover closes via the Cancel button', async () => {
    const { container } = render(
      <WerewolfTableSurface
        state={makeWaitingLobby()}
        onInvite={async () => {}}
        onInviteAgent={async () => {}}
      />,
    );
    const firstInvite = container.querySelector<HTMLButtonElement>('.ww-seat-invite')!;
    firstInvite.focus();
    fireEvent.click(firstInvite);

    // The popover renders a Cancel button (`.ww-agent-picker-cancel`) that
    // calls onClose on click. This path exercises the in-popover click
    // affordance separately from the document-level keydown listener. The
    // popover mounts through createPortal into document.body, so query the
    // body — not the test's container — for popover-internal elements.
    const cancel = document.body.querySelector<HTMLButtonElement>('.ww-agent-picker-cancel')!;
    expect(cancel).not.toBeNull();
    // Simulate the focus shift into the popover that a real user would
    // experience; see the parallel comment in the Escape test above.
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);

    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });

    expect(document.body.querySelector('.ww-agent-picker-cancel')).toBeNull();
    expect(document.activeElement).toBe(firstInvite);
  });
});
