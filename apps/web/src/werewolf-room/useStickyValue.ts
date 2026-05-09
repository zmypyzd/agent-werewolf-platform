import { useEffect, useState } from 'react';

// Display-layer fade timer for the broadcast booth's last-speech replay.
//
// Latches `value` SYNCHRONOUSLY during render (via React 18's allowed
// pattern of setState-during-render) so a brand-new value paints on the
// same frame instead of a render later. Without the synchronous latch the
// booth would flash the previous value for one render before catching up
// — invisible for most transitions but becomes the "skip" the user
// reported on the LAST day-speech speaker, where the orchestrator emits
// agent.action_received and phase.changed back-to-back inside one SSE
// frame and React 18 batches both into a single render that already
// shows currentSpeech=undefined.
//
// Each new latched value displays for `holdMs` then fades to undefined.
// New values cancel the pending fade and restart the window; the parent
// passing `value === undefined` (e.g. match completion clearing
// state.lastSpeech) clears immediately.
//
// `latchedValue` is what the hook last accepted from the parent. Tracking
// it separately from `visible` is what prevents the post-fade re-latch
// loop (after the timer clears `visible` to undefined, the next render
// must NOT treat `value` as "new" again — it's the same speech we already
// displayed and let fade).
//
// SSR-safe: the useState initializer passes `value` through, and
// setTimeout only runs inside useEffect (browser-only). renderToString
// tests see the live value without a fade window.
export function useStickyValue<T>(
  value: T | undefined,
  holdMs: number,
): T | undefined {
  const [{ visible, latchedValue, expiresAt }, setState] = useState<{
    visible: T | undefined;
    latchedValue: T | undefined;
    expiresAt: number;
  }>(() => ({
    visible: value,
    latchedValue: value,
    expiresAt: value !== undefined ? Date.now() + holdMs : 0,
  }));

  if (value !== undefined && value !== latchedValue) {
    // New speech arrived — latch and (re)start the fade window.
    setState({
      visible: value,
      latchedValue: value,
      expiresAt: Date.now() + holdMs,
    });
  } else if (value === undefined && latchedValue !== undefined) {
    // Parent explicitly cleared (match completion). Drop the sticky.
    setState({ visible: undefined, latchedValue: undefined, expiresAt: 0 });
  }

  useEffect(() => {
    if (visible === undefined || expiresAt === 0) return undefined;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      setState((s) =>
        s.visible === undefined
          ? s
          : { ...s, visible: undefined, expiresAt: 0 },
      );
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setState((s) =>
        s.visible === undefined
          ? s
          : { ...s, visible: undefined, expiresAt: 0 },
      );
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [visible, expiresAt]);

  return visible;
}
