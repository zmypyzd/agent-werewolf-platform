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
): WerewolfTimelineLine[] {
  const id = event.eventId;
  const ts = event.timestamp;

  if (event.eventType === 'match.started') {
    return [{ id, timestamp: ts, kind: 'system', text: '对局开始' }];
  }

  if (event.eventType === 'phase.changed') {
    const phase = phaseOf(event);
    if (typeof phase === 'string') {
      if (phase.startsWith(NIGHT_PHASE_PREFIX)) {
        const n = Number(event.data['nightNumber'] ?? 0);
        return [{ id, timestamp: ts, kind: 'phase-night', text: `🌙 夜 ${n}` }];
      }
      if (phase.startsWith(DAY_PHASE_PREFIX)) {
        const d = Number(event.data['dayNumber'] ?? 0);
        return [{ id, timestamp: ts, kind: 'phase-day', text: `☀️ 天 ${d}` }];
      }
      if (phase === 'game-over') {
        return [{ id, timestamp: ts, kind: 'system', text: '游戏结束' }];
      }
    }
    return [];
  }

  if (event.eventType === 'agent.action_received') {
    const phase = phaseOf(event);
    if (typeof phase === 'string' && phase.startsWith(NIGHT_PHASE_PREFIX)) {
      // Night actor identity is stripped by werewolfReplayEventToPublic.
      // Reducer folds these into a single system-night-fold line.
      return [];
    }
    const action = event.data['action'] as
      | { type?: string; targetId?: string; playerId?: string; performance?: string; speech?: string }
      | undefined;
    const playerId = event.data['playerId'];
    const reasoning = event.data['reasoningSummary'] as
      | { intent?: string }
      | undefined;

    if (action?.type === 'speak') {
      const speech = action.speech ?? '';
      const performance = action.performance ?? '';
      const speakLine: WerewolfTimelineLine = {
        id,
        timestamp: ts,
        kind: 'speak',
        text: `${nameOf(playerId, names)}: "${speech}"`,
        ...(performance ? { sub: performance } : {}),
      };
      const lines: WerewolfTimelineLine[] = [speakLine];
      if (reasoning?.intent) {
        lines.push({
          id: `${id}-reason`,
          timestamp: ts,
          kind: 'reason',
          text: `💭 ${reasoning.intent}`,
        });
      }
      return lines;
    }
    if (action?.type === 'day-vote') {
      return [{
        id,
        timestamp: ts,
        kind: 'vote',
        text: `${nameOf(playerId, names)} 投 ${nameOf(action.targetId, names)}`,
      }];
    }
    return [{
      id,
      timestamp: ts,
      kind: 'system',
      text: `${nameOf(playerId, names)} 行动`,
    }];
  }

  if (event.eventType === 'match.completed') {
    const winner = event.data['winner'];
    const text =
      winner === 'good'
        ? '🏁 终局：好人胜'
        : winner === 'werewolf'
          ? '🏁 终局：狼人胜'
          : '🏁 终局';
    return [{ id, timestamp: ts, kind: 'completion', text }];
  }

  // engine.action_applied / agent.action_requested are pure transport noise
  // for the spectator timeline — their effects surface through phase.changed,
  // agent.action_received (speak/vote), and the night-fold collapse. Emitting
  // a raw "[engine.action_applied]" line here would flood the timeline and
  // also block the night-fold dedupe in the reducer (which only fires when
  // the normalizer returns []).
  if (
    event.eventType === 'engine.action_applied' ||
    event.eventType === 'agent.action_requested'
  ) {
    return [];
  }

  if (event.eventType === 'agent.timeout') {
    const playerId = event.data['playerId'];
    return [{
      id,
      timestamp: ts,
      kind: 'system',
      text: `${nameOf(playerId, names)} 超时`,
    }];
  }

  if (event.eventType === 'agent.invalid_action') {
    const playerId = event.data['playerId'];
    return [{
      id,
      timestamp: ts,
      kind: 'system',
      text: `${nameOf(playerId, names)} 动作无效`,
    }];
  }

  return [];
}
