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

function causeLabel(cause: string): string {
  switch (cause) {
    case 'wolf-kill':
      return '夜里被狼刀';
    case 'witch-poison':
      return '女巫毒杀';
    case 'banishment':
      return '白天投票放逐';
    case 'hunter-shoot':
      return '猎人开枪';
    default:
      return cause;
  }
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
    const lines: WerewolfTimelineLine[] = [];

    // Eliminations announced by this transition. Wolf-kill / witch-poison
    // surface on day-announce; banishment after day-resolve; hunter-shoot
    // immediately. Each death gets its own timeline line so spectators see
    // the cause, not just the body count.
    const eliminatedRaw = event.data['eliminated'];
    const eliminated = Array.isArray(eliminatedRaw)
      ? eliminatedRaw.filter(
          (e): e is { playerId: string; cause: string } =>
            typeof e === 'object' &&
            e !== null &&
            typeof (e as Record<string, unknown>)['playerId'] === 'string' &&
            typeof (e as Record<string, unknown>)['cause'] === 'string',
        )
      : [];
    for (let i = 0; i < eliminated.length; i++) {
      const d = eliminated[i]!;
      lines.push({
        id: `${id}-death-${i}`,
        timestamp: ts,
        kind: 'system',
        text: `💀 ${nameOf(d.playerId, names)} 出局（${causeLabel(d.cause)}）`,
      });
    }

    // PK round indicator. The engine loops back into day-vote on a tie or no
    // strict majority, up to WEREWOLF_MAX_PK_ROUNDS. Surface this so the
    // user understands the second round of vote events is a re-vote, not
    // duplicate/stuck events.
    const pkRound =
      typeof event.data['pkRound'] === 'number'
        ? (event.data['pkRound'] as number)
        : 0;
    if (phase === 'day-vote' && pkRound > 0) {
      lines.push({
        id: `${id}-pk`,
        timestamp: ts,
        kind: 'system',
        text: `⚖️ 票数相同，进入第 ${pkRound + 1} 轮决战投票`,
      });
    }

    if (typeof phase === 'string') {
      if (phase.startsWith(NIGHT_PHASE_PREFIX)) {
        const n = Number(event.data['nightNumber'] ?? 0);
        lines.push({ id, timestamp: ts, kind: 'phase-night', text: `🌙 夜 ${n}` });
      } else if (phase.startsWith(DAY_PHASE_PREFIX)) {
        const d = Number(event.data['dayNumber'] ?? 0);
        // Don't double-emit a phase-day banner on the PK revote — pkRound is
        // a re-emitted day-vote event, not a fresh day. The PK line above
        // already explains what's happening.
        if (pkRound === 0) {
          lines.push({ id, timestamp: ts, kind: 'phase-day', text: `☀️ 天 ${d}` });
        }
      } else if (phase === 'game-over') {
        lines.push({ id, timestamp: ts, kind: 'system', text: '游戏结束' });
      }
    }
    return lines;
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
    if (action?.type === 'hunter-shoot') {
      // The death itself surfaces on the next phase.changed via eliminated[].
      // This line announces the moment the hunter pulls the trigger so the
      // spectator sees the cause before the body lands.
      const text =
        action.targetId === null || action.targetId === undefined
          ? `🏹 ${nameOf(playerId, names)} 放弃开枪`
          : `🏹 ${nameOf(playerId, names)} 开枪 → ${nameOf(action.targetId, names)}`;
      return [{ id, timestamp: ts, kind: 'system', text }];
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
