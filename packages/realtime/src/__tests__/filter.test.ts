import { describe, it, expect } from 'vitest';
import type { Card, PokerReplayEventType, ReplayEvent } from '@agent-poker/shared';
import { replayEventToPublic } from '../filter.js';

const HOLE: [Card, Card] = [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }];

// `makeEvent` accepts an arbitrary string for `eventType` and casts into
// `PokerReplayEventType` so the fuzz / fail-closed tests below can plant
// unknown event types ('mystery.event', 'community_cards.dealt', etc.)
// at runtime — the cast is the test's deliberate misuse of the narrow
// union, exercising the filter's runtime fail-closed default arm.
function makeEvent(eventType: string, data: Record<string, unknown>): ReplayEvent {
  return {
    eventId: 'e-1', handId: 'h-1', tableId: 't-1',
    sequence: 0, eventType: eventType as PokerReplayEventType, timestamp: 1, data,
  };
}

describe('replayEventToPublic', () => {
  it('drops hole_cards.dealt entirely', () => {
    const event = makeEvent('hole_cards.dealt', { playerId: 'p-1', holeCards: HOLE });
    expect(replayEventToPublic(event)).toBeNull();
  });

  it('strips holeCards from showdown.started.players', () => {
    const event = makeEvent('showdown.started', {
      players: [
        { playerId: 'p-1', seatIndex: 0, holeCards: HOLE },
        { playerId: 'p-2', seatIndex: 1, holeCards: HOLE },
      ],
    });
    const out = replayEventToPublic(event)!;
    const players = out.data['players'] as Array<Record<string, unknown>>;
    for (const p of players) {
      expect(p).not.toHaveProperty('holeCards');
    }
    expect(players).toHaveLength(2);
  });

  it('passes pure public events through unchanged', () => {
    const event = makeEvent('action.applied', { playerId: 'p-1', actionType: 'check', amount: 0 });
    const out = replayEventToPublic(event)!;
    expect(out).toEqual(event);
  });

  it('defensively strips a holeCards key planted in unknown nested locations', () => {
    const event = makeEvent('mystery.event', {
      meta: {
        bystanders: [{ playerId: 'x', holeCards: HOLE }],
      },
    });
    const out = replayEventToPublic(event)!;
    expect(JSON.stringify(out)).not.toContain('"holeCards"');
  });

  it('passes a wide range of randomized events without ever leaking holeCards (1000-shape fuzz)', () => {
    // Seeded mulberry32 so the fuzz is reproducible across machines.
    const rand = mulberry32(0xC0FFEE);
    const types = [
      'action.requested', 'action.applied', 'community_cards.dealt',
      'pot.awarded', 'agent.timeout', 'agent.invalid_action',
      'showdown.started', 'showdown.result', 'mystery.event',
    ];
    for (let i = 0; i < 1000; i++) {
      const t = types[Math.floor(rand() * types.length)]!;
      const data = makeRandomData(rand, /*depth*/ 0, /*plantHoleCards*/ rand() < 0.5);
      const event = makeEvent(t, data);
      const out = replayEventToPublic(event);
      if (out) {
        const json = JSON.stringify(out);
        if (json.includes('"holeCards"')) {
          throw new Error(`leak in iteration ${i} (event ${t}): ${json}`);
        }
      }
    }
  });
});

function makeRandomData(rand: () => number, depth: number, plantHoleCards: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = ['agentId', 'playerId', 'amount', 'meta', 'nested', 'players', 'bystanders'];
  const numKeys = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < numKeys; i++) {
    const key = keys[Math.floor(rand() * keys.length)]!;
    const r = rand();
    if (r < 0.3) {
      out[key] = `s-${Math.floor(rand() * 1e6)}`;
    } else if (r < 0.5) {
      out[key] = Math.floor(rand() * 10000);
    } else if (r < 0.7 && depth < 4) {
      // Nested object — recurse.
      out[key] = makeRandomData(rand, depth + 1, plantHoleCards && rand() < 0.5);
    } else if (r < 0.85 && depth < 4) {
      // Array of objects.
      const len = 1 + Math.floor(rand() * 3);
      const arr: unknown[] = [];
      for (let j = 0; j < len; j++) {
        arr.push(makeRandomData(rand, depth + 1, plantHoleCards && rand() < 0.5));
      }
      out[key] = arr;
    } else {
      out[key] = null;
    }
  }
  // Sometimes plant hole cards at this level.
  if (plantHoleCards && rand() < 0.3) {
    out['holeCards'] = HOLE;
  }
  return out;
}

// Deterministic 32-bit PRNG (same as poker-engine's deck shuffler).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
