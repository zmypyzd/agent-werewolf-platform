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
  const isRunningUnknownPhase = status === 'running' && !isNight && !isDay;
  const isWaiting =
    !isRunningUnknownPhase &&
    (status === 'waiting' || currentPhase === 'pre-match');

  let label: string;
  if (status === 'failed') {
    label = '异常终止';
  } else if (status === 'completed') {
    label = '🏁 已结束';
  } else if (isNight) {
    label = `🌙 夜 ${nightNumber}`;
  } else if (isDay) {
    label = `☀️ 天 ${dayNumber}`;
  } else if (isRunningUnknownPhase) {
    label = '对局进行中';
  } else {
    label = '等待开局';
  }

  const subtitle = isRunningUnknownPhase
    ? 'GAME IN PROGRESS'
    : PHASE_SUBTITLES[currentPhase as string] ??
      (isNight
        ? `NIGHT · ROUND ${nightNumber}`
        : isDay
          ? `DAY · ROUND ${dayNumber}`
          : undefined);

  const barClass = [
    'ww-phase-bar',
    isNight ? 'is-night' : '',
    isDay ? 'is-day' : '',
    isWaiting ? 'is-waiting' : '',
    isEnded ? 'is-ended' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={barClass}>
      <div className="ww-phase-row">
        <div className="ww-phase-dot" />
        <span className="ww-phase-text">{label}</span>
        <div className="ww-phase-dot" />
      </div>
      {subtitle ? <div className="ww-phase-sub">{subtitle}</div> : null}
    </div>
  );
}
