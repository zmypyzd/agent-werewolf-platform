import type { WerewolfRoomState } from './werewolfRoomTypes.js';

export interface WerewolfPhaseIndicatorProps {
  state: WerewolfRoomState;
}

const PHASE_SUBTITLES: Record<string, string> = {
  setup:                  'PREPARING GAME',
  'night-werewolf-vote':  'WEREWOLVES CHOOSING TARGET',
  'night-witch':          'WITCH ACTING',
  'night-seer':           'SEER INVESTIGATING',
  'night-resolve':        'RESOLVING NIGHT',
  'day-announce':         'ANNOUNCING DEATHS',
  'day-speeches':         'SPEECHES IN PROGRESS',
  'day-vote':             'VOTING IN PROGRESS',
  'day-resolve':          'RESOLVING VOTE',
  'hunter-shoot':         'HUNTER SHOOTING',
  'game-over':            'GAME ENDED',
  'pre-match':            'WAITING FOR PLAYERS',
  completed:              'MATCH COMPLETE',
};

export function WerewolfPhaseIndicator({ state }: WerewolfPhaseIndicatorProps) {
  const { currentPhase, dayNumber, nightNumber, status } = state;

  const isNight =
    typeof currentPhase === 'string' && currentPhase.startsWith('night-');
  const isDay =
    typeof currentPhase === 'string' && currentPhase.startsWith('day-');
  const isEnded = status === 'completed' || status === 'failed';

  // Late-joining spectators receive `status: 'running'` from the lobby
  // poll but no phase events (SSE has no backlog — see
  // apps/api/src/routes/werewolf-stream.ts). Without a fallback the bar
  // would render '等待开局 / WAITING FOR PLAYERS' for a clearly-running
  // match. Surface a generic "in progress" label instead until the next
  // phase.changed event lands and the precise day/night reading replaces it.
  // Pre-existing: late-joining spectators see status='running' but no phase
  // events yet. Kept as a class signal even though the label/subtitle are
  // now computed via isUnnumberedRunning (which strictly subsumes this).
  const isRunningUnknownPhase = status === 'running' && !isNight && !isDay;
  const isWaiting =
    !isRunningUnknownPhase &&
    (status === 'waiting' || currentPhase === 'pre-match');

  // emptyRoomState seeds nightNumber/dayNumber to 0 (sentinel). If a night-/
  // day-prefixed currentPhase arrives before phase.changed has populated a
  // real round number, rendering "🌙 夜 0" / "☀️ 天 0" misleads spectators
  // — there is no round 0 in the game. Detect the sentinel and fall back to
  // the unnumbered "running-unknown" copy until a real number lands.
  const hasRealNightNumber = typeof nightNumber === 'number' && nightNumber > 0;
  const hasRealDayNumber = typeof dayNumber === 'number' && dayNumber > 0;
  const isNumberedNight = isNight && hasRealNightNumber;
  const isNumberedDay = isDay && hasRealDayNumber;
  const isUnnumberedRunning =
    !isNumberedNight && !isNumberedDay && (status === 'running' || isNight || isDay);

  let label: string;
  if (status === 'failed') {
    label = '异常终止';
  } else if (status === 'completed') {
    label = '🏁 已结束';
  } else if (isNumberedNight) {
    label = `🌙 夜 ${nightNumber}`;
  } else if (isNumberedDay) {
    label = `☀️ 天 ${dayNumber}`;
  } else if (isUnnumberedRunning) {
    label = '对局进行中';
  } else {
    label = '等待开局';
  }

  // Subtitle: if the match has failed, surface a fixed "MATCH FAILED" string
  // instead of the underlying phase-keyed subtitle. Without this, a lobby
  // that fails before the first phase.changed event renders the contradictory
  // pair "异常终止" + "WAITING FOR PLAYERS" — the label says we ended, the
  // subtitle says we're still waiting. Same defense for the completed path
  // (status takes precedence over currentPhase if currentPhase is stale).
  let subtitle: string | undefined;
  if (status === 'failed') {
    subtitle = 'MATCH FAILED';
  } else if (status === 'completed') {
    subtitle = PHASE_SUBTITLES['completed'];
  } else if (isUnnumberedRunning) {
    subtitle = 'GAME IN PROGRESS';
  } else {
    subtitle =
      PHASE_SUBTITLES[currentPhase as string] ??
      (isNumberedNight
        ? `NIGHT · ROUND ${nightNumber}`
        : isNumberedDay
          ? `DAY · ROUND ${dayNumber}`
          : undefined);
  }

  const barClass = [
    'ww-phase-bar',
    isNight ? 'is-night' : '',
    isDay ? 'is-day' : '',
    isWaiting ? 'is-waiting' : '',
    isEnded ? 'is-ended' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // a11y: phase transitions (night ↔ day, hunter-shoot fires, game-over) are
  // load-bearing for sighted users via color + emoji shift. Mark the bar as
  // a polite live region so screen readers announce the new phase as soon as
  // the reducer flips it. `polite` (not `assertive`) matches the timeline +
  // speech board convention and avoids interrupting an in-progress speech
  // read-out. `aria-atomic` ensures the whole label is read on each change
  // rather than only the diffed sub-string.
  const ariaLabel = subtitle ? `${label} · ${subtitle}` : label;

  return (
    <div
      className={barClass}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={ariaLabel}
    >
      <div className="ww-phase-row">
        <span className="ww-phase-text">{label}</span>
        {/* Single pulse dot to the right of the label, matching the
            approved Pretext-native finalized.html phase banner. The
            decorative `◇ — ◇` corner markers come from CSS pseudo-
            elements on .ww-phase-bar so the JSX stays minimal. */}
        <div className="ww-phase-dot" aria-hidden="true" />
      </div>
      {subtitle ? <div className="ww-phase-sub">{subtitle}</div> : null}
    </div>
  );
}
