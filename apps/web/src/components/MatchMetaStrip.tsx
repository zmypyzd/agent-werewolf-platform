import { useEffect, useState } from 'react';
import type { WerewolfRoomState } from '../werewolf-room/werewolfRoomTypes.js';

export interface MatchMetaStripProps {
  state: WerewolfRoomState;
  // Match name (from ServerLobbyEntry.name). Optional — falls back to gameId
  // slice when absent so the strip never collapses to "Untitled".
  name?: string | undefined;
  // Wall-clock start of the match (ServerLobbyEntry.startedAt). Drives the
  // elapsed counter. Absent pre-start; in that case we show "—:—:—".
  startedAt?: number | undefined;
  // Live spectator count. Backend exposure pending; pass undefined to omit
  // the cell entirely rather than show a fake number.
  viewerCount?: number | undefined;
  // Stable episode label derived deterministically from gameId so the strip
  // matches the approved mockup's "EP-47" affordance without needing a
  // backend episode counter. Caller decides the derivation (or omits).
  episodeLabel?: string | undefined;
  // Pre-formatted model matchup tally, e.g. "3×GPT-4 · 4×Claude · 2×Llama".
  // Computed by the caller from seats so this component stays presentational.
  modelMatchup?: string | undefined;
  // Engine version string. Pulled from package.json at the call site; passed
  // through so the strip is still useful in storybook / future demos.
  engineVersion?: string | undefined;
  // True when the room is rendering omniscient spectator view. Drives the
  // amber "OBSERVER ROLES ON" pill that signals "you can see all roles".
  observerMode?: boolean | undefined;
}

function fmtElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function statusLabel(status: WerewolfRoomState['status']): string {
  switch (status) {
    case 'running':   return 'LIVE';
    case 'ready':     return 'READY';
    case 'waiting':   return 'WAITING';
    case 'completed': return 'FINAL';
    case 'failed':    return 'ERROR';
  }
}

// Show the freshest round we can derive. nightNumber leads day in our
// engine sequence (night-1 → day-1 → night-2 …), so when both are non-zero
// pick whichever is greater. dayNumber is what the user is "in" most of
// the time so it wins on ties.
function roundLabel(state: WerewolfRoomState): string | null {
  const d = state.dayNumber ?? 0;
  const n = state.nightNumber ?? 0;
  if (d === 0 && n === 0) return null;
  if (d >= n) return `DAY ${d}`;
  return `NIGHT ${n}`;
}

export function MatchMetaStrip({
  state,
  name,
  startedAt,
  viewerCount,
  episodeLabel,
  modelMatchup,
  engineVersion,
  observerMode,
}: MatchMetaStripProps) {
  // Re-render once per second while the match is running so the elapsed
  // counter actually ticks. Outside of running we leave the timer frozen
  // (waiting → no startedAt yet; completed → server should freeze it).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (state.status !== 'running') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.status]);

  const label = statusLabel(state.status);
  const round = roundLabel(state);
  const displayName = name?.trim() || state.gameId.slice(0, 8);
  const elapsedText = startedAt ? fmtElapsed(now - startedAt) : null;

  const isLive = state.status === 'running';
  const isError = state.status === 'failed';

  return (
    <div className="ww-match-meta-strip" role="status" aria-live="polite">
      <div className="ww-match-meta-strip-l">
        <span
          className={`ww-match-meta-pill ww-match-meta-pill-${state.status}`}
          aria-label={`Match status: ${label}`}
        >
          {isLive ? <span className="ww-match-meta-live-dot" aria-hidden="true" /> : null}
          {label}
        </span>
        <span className="ww-match-meta-name" title={state.gameId}>
          {displayName}
        </span>
        {viewerCount !== undefined ? (
          <>
            <span className="ww-match-meta-sep" aria-hidden="true">|</span>
            <span className="ww-match-meta-cell">
              <strong>{viewerCount}</strong> watching
            </span>
          </>
        ) : null}
        {episodeLabel ? (
          <>
            <span className="ww-match-meta-sep" aria-hidden="true">|</span>
            <span className="ww-match-meta-cell ww-match-meta-cell-ep">{episodeLabel}</span>
          </>
        ) : null}
        {elapsedText ? (
          <>
            <span className="ww-match-meta-sep" aria-hidden="true">|</span>
            <span className="ww-match-meta-cell">
              elapsed <strong>{elapsedText}</strong>
            </span>
          </>
        ) : null}
        {round ? <span className="ww-match-meta-round">{round}</span> : null}
        {observerMode ? (
          <span className="ww-match-meta-observer" aria-label="Observer roles visible">
            OBSERVER ROLES ON
          </span>
        ) : null}
      </div>
      <div className="ww-match-meta-strip-r">
        <span className="ww-match-meta-cell">
          seed <strong>#{state.gameId.slice(0, 8)}</strong>
        </span>
        {modelMatchup ? (
          <>
            <span className="ww-match-meta-sep" aria-hidden="true">|</span>
            <span className="ww-match-meta-cell ww-match-meta-cell-matchup">
              {modelMatchup}
            </span>
          </>
        ) : null}
        {engineVersion ? (
          <>
            <span className="ww-match-meta-sep" aria-hidden="true">|</span>
            <span className="ww-match-meta-cell ww-match-meta-cell-engine">
              engine <strong>{engineVersion}</strong>
            </span>
          </>
        ) : null}
        <span className="ww-match-meta-sep" aria-hidden="true">|</span>
        <span className="ww-match-meta-cell">
          {state.seats.filter((s) => s.occupant.kind !== 'empty').length}/9 seated
        </span>
        {isError && state.failureReason ? (
          <>
            <span className="ww-match-meta-sep" aria-hidden="true">·</span>
            <span className="ww-match-meta-cell ww-match-meta-cell-error">
              {state.failureReason}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
