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

