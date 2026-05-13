import type { PokerReplayEventType, ReplayEvent } from '@agent-poker/shared';

// Public broadcast filter for ReplayEvents emitted by HandRunner. Routes
// every event variant through an exhaustive `switch` on
// `PokerReplayEventType` so adding a new event in `hand-runner.ts` (and
// therefore widening the union) forces the developer to classify it
// here too — the default arm asserts `never`, which fails compilation
// until the new variant gets an explicit case. Mirrors the werewolf
// filter's exhaustiveness fix (PR #37).
//
// Returns null if the event must NOT be broadcast publicly at all (e.g.
// hole_cards.dealt, which is private to the seated user). Returns a
// sanitized copy when the event is publishable but its payload may
// embed hole cards (e.g. showdown.started). Returns the original
// reference for events that are fully public, so consumers can compare
// by reference for cheap pass-through detection.
export function replayEventToPublic(event: ReplayEvent): ReplayEvent | null {
  switch (event.eventType) {
    // Never broadcast — private to one seat. The seated user receives a
    // mirror via the seat:<userId>:<tableId> topic, populated by the
    // orchestrator.
    case 'hole_cards.dealt':
      return null;

    // showdown.started enumerates every player who reached showdown
    // along with their hole cards in the internal event. The public
    // form drops the per-player holeCards; cards are revealed
    // individually via the 'showdown.result' events that follow.
    case 'showdown.started':
      return stripShowdownStarted(event);

    // Public events. Defense-in-depth: even though hand-runner does not
    // embed hole cards in these payloads today, a future emit-site bug
    // (or a typo in the engine's state shape) could carry one along.
    // Deep-strip any `holeCards` field at any nesting depth before
    // broadcast. Return the original reference when nothing matches so
    // the fast-path stays zero-copy.
    case 'hand.started':
    case 'hand.completed':
    case 'blinds.posted':
    case 'community_cards.dealt':
    case 'betting_round.started':
    case 'betting_round.complete':
    case 'action.requested':
    case 'action.received':
    case 'action.applied':
    case 'agent.timeout':
    case 'agent.invalid_action':
    case 'pot.awarded':
    case 'showdown.result':
      return scrubIfHoleCards(event);

    default: {
      // Exhaustiveness guard — adding a new PokerReplayEventType variant
      // in @agent-poker/shared forces this default arm to fail
      // compilation until the new variant gets an explicit case above.
      const _exhaustive: never = event.eventType;
      void _exhaustive;
      // Runtime fail-closed: an unknown event type at runtime (a stale
      // realtime package shipped against a newer shared release) gets
      // deep-stripped just in case it carries hole cards. The compile
      // check is what catches the gap; this runtime branch is the
      // belt-and-braces fallback.
      return scrubIfHoleCards(event);
    }
  }
}

function stripShowdownStarted(event: ReplayEvent): ReplayEvent {
  const raw = event.data['players'];
  if (Array.isArray(raw)) {
    const stripped = raw.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const { holeCards: _omit, ...rest } = p as Record<string, unknown>;
      return rest;
    });
    return {
      ...event,
      data: { ...event.data, players: stripped },
    };
  }
  // `players` malformed or absent — fall back to the generic deep-strip
  // so a future shape change can't silently leak.
  return scrubIfHoleCards(event);
}

function scrubIfHoleCards(event: ReplayEvent): ReplayEvent {
  if (containsHoleCards(event.data)) {
    return {
      ...event,
      data: deepStripHoleCards(event.data) as Record<string, unknown>,
    };
  }
  return event;
}

function containsHoleCards(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsHoleCards);
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'holeCards') return true;
    if (containsHoleCards(v)) return true;
  }
  return false;
}

function deepStripHoleCards(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepStripHoleCards);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'holeCards') continue;
    out[k] = deepStripHoleCards(v);
  }
  return out;
}

export type { PokerReplayEventType };
