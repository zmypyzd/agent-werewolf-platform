import type { ReplayEvent } from '@agent-poker/shared';

// Public broadcast filter for ReplayEvents emitted by HandRunner.
// Returns null if the event must NOT be broadcast publicly at all
// (e.g. hole_cards.dealt, which is private to the seated user).
// Returns a sanitized copy when the event is publishable but its payload
// references hole cards belonging to other players (e.g. showdown.started).
export function replayEventToPublic(event: ReplayEvent): ReplayEvent | null {
  // hole_cards.dealt always carries a single player's hole cards. Spectators
  // and other seated players must never see it. The seated user receives a
  // mirror via the seat:<userId>:<tableId> topic, populated by the orchestrator.
  if (event.eventType === 'hole_cards.dealt') return null;

  // showdown.started enumerates every player who reached showdown along with
  // their hole cards in the *internal* event. The public form drops the cards;
  // they're revealed individually via 'showdown.result' events that follow.
  if (event.eventType === 'showdown.started') {
    const raw = event.data['players'];
    if (Array.isArray(raw)) {
      const stripped = raw.map(p => {
        if (!p || typeof p !== 'object') return p;
        const { holeCards: _omit, ...rest } = p as Record<string, unknown>;
        return rest;
      });
      return {
        ...event,
        data: { ...event.data, players: stripped },
      };
    }
    // Fall through to the generic deep-strip below if `players` is malformed.
  }

  // Defensive: any unrecognized payload that happens to carry holeCards is
  // scrubbed before broadcast. This is the single place that enforces the
  // "no hole cards leak to spectators" invariant from spec §5.
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
