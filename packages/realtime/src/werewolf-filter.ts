import type { WerewolfPhase, WerewolfReplayEvent } from '@agent-poker/shared';

const PRIVATE_PHASES: ReadonlySet<WerewolfPhase> = new Set([
  'night-werewolf-vote',
  'night-witch',
  'night-seer',
]);

const ACTOR_FIELDS_TO_STRIP = ['playerId', 'agentId'] as const;

// Public broadcast filter for WerewolfReplayEvent. Strips actor-identifying
// fields (playerId, agentId) from agent.action_* events that fire in private
// night phases. Returns the original reference when nothing needs redacting
// so consumers can compare by reference if they want.
//
// Returns null only as a future hook — currently every event is broadcastable
// in some form, so the implementation never returns null. The signature stays
// nullable so behavior can tighten later without breaking callers.
export function werewolfReplayEventToPublic(
  event: WerewolfReplayEvent,
): WerewolfReplayEvent | null {
  let next = event;
  if (isAgentActionEvent(event.eventType)) {
    const phase = event.data['phase'];
    if (typeof phase === 'string' && PRIVATE_PHASES.has(phase as WerewolfPhase)) {
      next = stripActorFields(next);
    }
  }
  // match.started carries the full match seed for in-process subscribers.
  // Spectators / persisted public artifacts must never see it: the seed
  // plus the engine's reproducibility property would let a viewer derive
  // every private RNG draw (role assignments, seer pings, etc).
  if (event.eventType === 'match.started' && 'seed' in next.data) {
    const { seed: _seed, ...rest } = next.data as Record<string, unknown>;
    next = { ...next, data: rest };
  }
  // Defense in depth: even on engine.action_applied (which is public), make
  // sure we never broadcast `inner` from a speak action.
  if (containsSpeakInner(next.data)) {
    next = { ...next, data: stripSpeakInner(next.data) as Record<string, unknown> };
  }
  return next;
}

function isAgentActionEvent(eventType: string): boolean {
  return (
    eventType === 'agent.action_requested' ||
    eventType === 'agent.action_received' ||
    eventType === 'agent.timeout' ||
    eventType === 'agent.invalid_action'
  );
}

function stripActorFields(event: WerewolfReplayEvent): WerewolfReplayEvent {
  const next: Record<string, unknown> = { ...event.data };
  for (const field of ACTOR_FIELDS_TO_STRIP) {
    delete next[field];
  }
  return { ...event, data: next };
}

function containsSpeakInner(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsSpeakInner);
  const obj = value as Record<string, unknown>;
  if (obj['type'] === 'speak' && Object.prototype.hasOwnProperty.call(obj, 'inner')) {
    return true;
  }
  for (const v of Object.values(obj)) {
    if (containsSpeakInner(v)) return true;
  }
  return false;
}

function stripSpeakInner(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripSpeakInner);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (obj['type'] === 'speak' && k === 'inner') continue;
    out[k] = stripSpeakInner(v);
  }
  return out;
}
