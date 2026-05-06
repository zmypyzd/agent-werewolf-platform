import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMatchRunner } from '../match-runner.js';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfReplayEvent } from '../replay-event.js';

// Phase 2 scope (issue: "出局/被刀的人不显示 + 投票感觉一天投了不止一轮"):
//   - phase.changed must carry an `eliminated` array on the transition that
//     publicly announces a death (day-announce / post-day-resolve / post-
//     hunter-shoot). Each entry is { playerId, cause }. Spectator UI flips
//     seat.alive=false from this.
//   - phase.changed must carry `pkRound` when the engine loops back into
//     day-vote on a tied / no-strict-majority outcome. The phase string
//     stays 'day-vote' across the loop, which is why spectators couldn't
//     tell "round 2" from "round 1, slow" before this fix.

interface DeathEntry {
  readonly playerId: string;
  readonly cause: string;
}

function isDeathArray(v: unknown): v is ReadonlyArray<DeathEntry> {
  return (
    Array.isArray(v) &&
    v.every(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as Record<string, unknown>)['playerId'] === 'string' &&
        typeof (e as Record<string, unknown>)['cause'] === 'string',
    )
  );
}

async function runMatchAndCollect(seed: string): Promise<WerewolfReplayEvent[]> {
  const initial = createGame({ gameId: `g-${seed}`, seed });
  const agents = new Map(
    initial.players.map((p) => [
      p.id,
      new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${seed}-${p.id}` }),
    ]),
  );
  const emitter = new EventEmitter();
  const events: WerewolfReplayEvent[] = [];
  emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
  const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
  await runner.run();
  return events;
}

describe('match-runner phase.changed eliminated + pkRound payload', () => {
  // Note on engine flow: 'day-announce' and 'night-resolve' are chained
  // INTERNAL phases — they never surface as standalone phase.changed events
  // because the engine collapses them inside one applyAction tick (see
  // packages/werewolf-engine/src/phases.ts:resolveNightAndAdvance line 106).
  // So night kills land on the phase.changed event that completes the chain
  // (typically day-speeches, sometimes hunter-shoot or game-over). Likewise
  // banishment lands on whatever follows day-resolve.

  it('night kills surface as eliminated[] on the first phase.changed AFTER night-resolve', async () => {
    const events = await runMatchAndCollect('eliminated-after-night');
    // Find the FIRST phase.changed event that carries eliminated[]. With
    // random agents producing deterministic seeded play, night 1 reliably
    // produces at least one kill on most seeds, but we don't hardcode which
    // phase string it lands on — the chain can end at day-speeches or
    // hunter-shoot depending on whether the wolf killed a hunter.
    const firstWithDeaths = events.find(
      (e) =>
        e.eventType === 'phase.changed' &&
        isDeathArray(e.data['eliminated']),
    );
    expect(firstWithDeaths, 'expected at least one phase.changed with eliminated[]').toBeDefined();
    const elim = firstWithDeaths!.data['eliminated'] as ReadonlyArray<DeathEntry>;
    expect(elim.length).toBeGreaterThan(0);
    for (const d of elim) {
      expect(['wolf-kill', 'witch-poison', 'banishment', 'hunter-shoot']).toContain(d.cause);
      expect(d.playerId.length).toBeGreaterThan(0);
    }
  });

  it('phase.changed carrying eliminated has playerIds present in the original roster', async () => {
    const seed = 'eliminated-roster-check';
    const initial = createGame({ gameId: `g-${seed}`, seed });
    const playerIds = new Set(initial.players.map((p) => p.id));
    const events = await runMatchAndCollect(seed);
    const phaseChanges = events.filter((e) => e.eventType === 'phase.changed');
    let totalDeaths = 0;
    for (const e of phaseChanges) {
      const elim = e.data['eliminated'];
      if (!isDeathArray(elim)) continue;
      for (const d of elim) {
        expect(playerIds).toContain(d.playerId);
        totalDeaths++;
      }
    }
    // A 9-player match always kills someone before game-over.
    expect(totalDeaths).toBeGreaterThan(0);
  });

  it('phase.changed without a death-tick has no eliminated field (omitted, not empty array)', async () => {
    const events = await runMatchAndCollect('no-death-omitted');
    const phaseChanges = events.filter((e) => e.eventType === 'phase.changed');
    // Find any phase.changed that doesn't carry deaths — e.g., entering
    // day-vote from day-speeches is a pure phase transition with zero
    // history.death entries appended. The contract is "omit, don't set [].".
    const noDeathEvents = phaseChanges.filter(
      (e) => !isDeathArray(e.data['eliminated']),
    );
    expect(noDeathEvents.length).toBeGreaterThan(0);
    for (const e of noDeathEvents) {
      // The field must be absent, not present-but-empty
      expect(e.data['eliminated']).toBeUndefined();
    }
  });

  it('phase.changed pkRound is omitted on the first entry into day-vote (round 0)', async () => {
    const events = await runMatchAndCollect('pk-round-zero');
    // Find the first phase.changed → day-vote of the match
    const firstDayVote = events.find(
      (e) =>
        e.eventType === 'phase.changed' &&
        e.data['phase'] === 'day-vote',
    );
    expect(firstDayVote).toBeDefined();
    expect(firstDayVote!.data['pkRound']).toBeUndefined();
  });

  it('phase stays day-vote across PK loops; phase.changed re-fires with pkRound>=1 when revote starts', async () => {
    // Search across many seeds — random agents only sometimes produce ties.
    // We give up after a fixed budget so the test stays fast and bounded.
    const seedsToTry = [
      'pk-seed-a', 'pk-seed-b', 'pk-seed-c', 'pk-seed-d', 'pk-seed-e',
      'pk-seed-f', 'pk-seed-g', 'pk-seed-h', 'pk-seed-i', 'pk-seed-j',
      'pk-seed-k', 'pk-seed-l', 'pk-seed-m', 'pk-seed-n', 'pk-seed-o',
      'pk-seed-p', 'pk-seed-q', 'pk-seed-r', 'pk-seed-s', 'pk-seed-t',
    ];
    let foundRevote = false;
    for (const seed of seedsToTry) {
      const events = await runMatchAndCollect(seed);
      const dayVotes = events.filter(
        (e) =>
          e.eventType === 'phase.changed' &&
          e.data['phase'] === 'day-vote',
      );
      const revote = dayVotes.find(
        (e) =>
          typeof e.data['pkRound'] === 'number' && (e.data['pkRound'] as number) >= 1,
      );
      if (revote) {
        foundRevote = true;
        // Sanity: pkRound is a small integer
        const r = revote.data['pkRound'] as number;
        expect(Number.isInteger(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(3);
        break;
      }
    }
    // It's improbable but not impossible that 20 seeds yield zero ties.
    // If this ever flakes, expand the seed list — we deliberately don't
    // engineer a forced-tie scenario here because that would couple this
    // regression to engine internals.
    expect(foundRevote, 'expected at least one PK revote across 20 random seeds').toBe(true);
  }, 30_000);

  it('every phase.changed still carries phase + nightNumber + dayNumber (existing contract held)', async () => {
    const events = await runMatchAndCollect('contract-still-holds');
    const phaseChanges = events.filter((e) => e.eventType === 'phase.changed');
    expect(phaseChanges.length).toBeGreaterThan(0);
    for (const e of phaseChanges) {
      expect(typeof e.data['phase']).toBe('string');
      expect(typeof e.data['nightNumber']).toBe('number');
      expect(typeof e.data['dayNumber']).toBe('number');
    }
  });
});
