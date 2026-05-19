import { useState } from 'react';

export interface AudienceStripProps {
  // We don't have a backend audience count yet — caller can pass a hint
  // (e.g. derived from a future watcher-count poll). When omitted we show
  // a self-only "1 watching" so the strip still anchors the bottom of the
  // game-room visually instead of collapsing to nothing.
  watching?: number | undefined;
  // EP-N badge shown in the left cluster. Optional — falls back to the
  // game id slice when absent so spectators always see a stable identifier.
  episodeId?: string | undefined;
}

interface ReactionState {
  emoji: string;
  count: number;
}

// Local-only reaction counts. The backend doesn't expose a real reaction
// stream yet — this is presentation-layer optimism so the bottom of the
// room never reads as a dead "demo" surface. When the reactions endpoint
// lands, replace this with a useReducer wired to SSE.
const INITIAL_REACTIONS: ReadonlyArray<ReactionState> = [
  { emoji: '❤️', count: 0 },
  { emoji: '🔥', count: 0 },
  { emoji: '😱', count: 0 },
  { emoji: '🐺', count: 0 },
  { emoji: '👏', count: 0 },
];

export function AudienceStrip({ watching, episodeId }: AudienceStripProps) {
  const [reactions, setReactions] = useState<ReadonlyArray<ReactionState>>(INITIAL_REACTIONS);

  function bump(emoji: string) {
    setReactions((prev) =>
      prev.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1 } : r)),
    );
  }

  const watchCount = watching ?? 1;
  const labelEp = episodeId ? `EP-${episodeId.slice(0, 6)}` : null;

  // Flattened single-row layout matching the approved finalized.html
  // .audience strip: AUDIENCE label · WATCHING count · | · BROADCAST EP · |
  // · 5 reactions inline · "+ REACT" spark right-aligned. Reaction buttons
  // stay interactive (increment counts on click) so the page still feels
  // alive even though there's no real reaction stream yet.
  return (
    <footer className="ww-audience-strip" aria-label="Audience">
      <b className="ww-audience-strip-label">AUDIENCE</b>
      <span className="ww-audience-strip-count">
        <strong>{watchCount}</strong> watching
      </span>
      {labelEp ? (
        <>
          <span className="ww-audience-strip-sep" aria-hidden="true">|</span>
          <span className="ww-audience-strip-ep">BROADCAST {labelEp}</span>
        </>
      ) : null}
      <span className="ww-audience-strip-sep" aria-hidden="true">|</span>
      <div className="ww-audience-strip-reactions" role="group" aria-label="React">
        {reactions.map((r) => (
          <button
            key={r.emoji}
            type="button"
            className="ww-audience-react"
            onClick={() => bump(r.emoji)}
            aria-label={`React ${r.emoji}`}
          >
            <span aria-hidden="true">{r.emoji}</span>
            <strong>{r.count}</strong>
          </button>
        ))}
      </div>
      <span className="ww-audience-strip-spark" aria-hidden="true">+ REACT</span>
    </footer>
  );
}
