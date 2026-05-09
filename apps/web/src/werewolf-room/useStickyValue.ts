import { useEffect, useState } from 'react';

// Display-layer "stickiness": when `value` flips from defined → undefined,
// keep returning the last defined value for `holdMs` more milliseconds, then
// clear. New defined values always replace the sticky value immediately and
// cancel any pending clear.
//
// Used by the werewolf broadcast booth (WerewolfSpeechBoard) and the seat
// replay glow (WerewolfTableSurface) so the LAST day-speech speaker stays
// visible long enough to read after the engine fires phase.changed →
// day-vote. The reducer clears state.currentSpeech the moment phase changes
// (see werewolfRoomReducer.ts); without this hook the last speaker would
// flash for less than a frame and appear "skipped" on the speech board even
// though their line is in the timeline. Keeping the timing in the
// presentation layer leaves the reducer pure and avoids the previous fix's
// failure mode where currentSpeech lingered on the booth for the entire
// voting phase (potentially 60s+).
//
// SSR-safe: the initial useState picks up `value` directly, and the
// setTimeout only runs inside useEffect (browser-only). renderToString /
// renderToStaticMarkup tests therefore see the live value with no hold.
export function useStickyValue<T>(
  value: T | undefined,
  holdMs: number,
): T | undefined {
  const [sticky, setSticky] = useState<T | undefined>(value);

  useEffect(() => {
    if (value !== undefined) {
      setSticky(value);
      return undefined;
    }
    const timer = window.setTimeout(() => setSticky(undefined), holdMs);
    return () => window.clearTimeout(timer);
  }, [value, holdMs]);

  return sticky;
}
