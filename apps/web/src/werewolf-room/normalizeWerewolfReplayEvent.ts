import type {
  WerewolfReplayEvent,
  WerewolfTimelineLine,
} from './werewolfRoomTypes.js';

const NIGHT_PHASE_PREFIX = 'night-';
const DAY_PHASE_PREFIX = 'day-';

export type NameIndex = Readonly<Record<string, string>>;

function nameOf(playerId: unknown, names: NameIndex): string {
  if (typeof playerId !== 'string') return '???';
  return names[playerId] ?? playerId;
}

function phaseOf(event: WerewolfReplayEvent): string | undefined {
  const v = event.data['phase'];
  return typeof v === 'string' ? v : undefined;
}

export function normalizeWerewolfReplayEvent(
  event: WerewolfReplayEvent,
  names: NameIndex,
): WerewolfTimelineLine | null {
  const id = event.eventId;
  const ts = event.timestamp;

  if (event.eventType === 'match.started') {
    return { id, timestamp: ts, kind: 'system', text: '对局开始' };
  }

  if (event.eventType === 'phase.changed') {
    const phase = phaseOf(event);
    if (typeof phase === 'string') {
      if (phase.startsWith(NIGHT_PHASE_PREFIX)) {
        const n = Number(event.data['nightNumber'] ?? 0);
        return { id, timestamp: ts, kind: 'phase-night', text: `🌙 夜 ${n}` };
      }
      if (phase.startsWith(DAY_PHASE_PREFIX)) {
        const d = Number(event.data['dayNumber'] ?? 0);
        return { id, timestamp: ts, kind: 'phase-day', text: `☀️ 天 ${d}` };
      }
      if (phase === 'game-over') {
        return { id, timestamp: ts, kind: 'system', text: '游戏结束' };
      }
    }
    return null;
  }

  if (event.eventType === 'agent.action_received') {
    const phase = phaseOf(event);
    if (typeof phase === 'string' && phase.startsWith(NIGHT_PHASE_PREFIX)) {
      // Night actor identity is stripped by werewolfReplayEventToPublic.
      // Reducer folds these into a single system-night-fold line.
      return null;
    }
    const action = event.data['action'] as
      | { type?: string; targetId?: string }
      | undefined;
    const playerId = event.data['playerId'];
    if (action?.type === 'speak') {
      return {
        id,
        timestamp: ts,
        kind: 'speak',
        text: `${nameOf(playerId, names)} 发言`,
      };
    }
    if (action?.type === 'vote') {
      return {
        id,
        timestamp: ts,
        kind: 'vote',
        text: `${nameOf(playerId, names)} 投 ${nameOf(action.targetId, names)}`,
      };
    }
    return {
      id,
      timestamp: ts,
      kind: 'system',
      text: `${nameOf(playerId, names)} 行动`,
    };
  }

  if (event.eventType === 'match.completed') {
    const winner = event.data['winner'];
    const text =
      winner === 'good'
        ? '🏁 终局：好人胜'
        : winner === 'werewolf'
          ? '🏁 终局：狼人胜'
          : '🏁 终局';
    return { id, timestamp: ts, kind: 'completion', text };
  }

  // engine.action_applied / agent.action_requested / agent.timeout / agent.invalid_action
  return { id, timestamp: ts, kind: 'system', text: `[${event.eventType}]` };
}
