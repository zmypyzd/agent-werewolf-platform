import type { WerewolfRoomState } from './werewolfRoomTypes.js';

export interface WerewolfPhaseIndicatorProps {
  state: WerewolfRoomState;
}

export function WerewolfPhaseIndicator({ state }: WerewolfPhaseIndicatorProps) {
  const { currentPhase, dayNumber, nightNumber, status } = state;
  let label = '准备中';
  if (status === 'completed') label = '已结束';
  else if (status === 'failed') label = '异常终止';
  else if (typeof currentPhase === 'string' && currentPhase.startsWith('night-')) {
    label = `🌙 夜 ${nightNumber}`;
  } else if (typeof currentPhase === 'string' && currentPhase.startsWith('day-')) {
    label = `☀️ 天 ${dayNumber}`;
  } else if (currentPhase === 'pre-match') {
    label = '等待开局';
  }
  return (
    <div className="werewolf-phase">
      <span className="werewolf-phase-label">{label}</span>
    </div>
  );
}
