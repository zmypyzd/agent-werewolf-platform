import type {
  WerewolfPhase,
  WerewolfReplayEvent,
  WerewolfReplayEventType,
} from '@agent-poker/shared';

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
    if (typeof phase === 'string' && isPrivatePhase(phase as WerewolfPhase)) {
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

// Exhaustiveness guard — adding a new WerewolfReplayEventType variant in
// shared forces the default arm here to fail compilation until the new
// event is explicitly classified as agent-action or not. Without this
// switch, a string-list check would silently let a new event type leak
// actor IDs in private phases. The runtime default is fail-closed
// (returns true → strip more rather than less) as defense-in-depth
// against a stale build that ships ahead of this file.
function isAgentActionEvent(eventType: WerewolfReplayEventType): boolean {
  switch (eventType) {
    case 'agent.action_requested':
    case 'agent.action_received':
    case 'agent.timeout':
    case 'agent.invalid_action':
      return true;
    case 'match.started':
    case 'match.completed':
    case 'engine.action_applied':
    case 'phase.changed':
      return false;
    default: {
      const _exhaustive: never = eventType;
      void _exhaustive;
      // Fail-closed: an unknown event type at runtime is treated as an
      // agent-action so the actor-stripping path can still engage if the
      // phase is private. Pairs with isPrivatePhase's fail-closed default.
      return true;
    }
  }
}

// Exhaustiveness guard — adding a new WerewolfPhase variant in shared
// forces the default arm here to fail compilation until the new phase is
// explicitly classified as public or private. The runtime default is
// fail-closed (returns true → treated as private → strip actor fields)
// because info-isolation invariants are more important to preserve than
// the optical loss of stripping a field on an unrecognised public phase.
function isPrivatePhase(phase: WerewolfPhase): boolean {
  switch (phase) {
    case 'night-werewolf-vote':
    case 'night-witch':
    case 'night-seer':
      return true;
    case 'setup':
    case 'night-resolve':
    case 'day-announce':
    case 'day-speeches':
    case 'day-vote':
    case 'day-resolve':
    case 'hunter-shoot':
    case 'game-over':
      return false;
    default: {
      const _exhaustive: never = phase;
      void _exhaustive;
      return true;
    }
  }
}

function stripActorFields(event: WerewolfReplayEvent): WerewolfReplayEvent {
  const next: Record<string, unknown> = { ...event.data };
  for (const field of ACTOR_FIELDS_TO_STRIP) {
    delete next[field];
  }
  return { ...event, data: next };
}
