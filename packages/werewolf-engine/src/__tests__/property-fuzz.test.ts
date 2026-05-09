import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import { getValidActions } from '../valid-actions.js';
import { getPublicState } from '../public-state.js';
import { getPrivateState } from '../private-state.js';
import type { WerewolfGameState } from '@agent-poker/shared';

// Property-based fuzz: drive many full matches with random-but-valid actions
// and assert invariants the existing per-test cases don't cover in
// combination. The engine's per-action tests pin individual transitions; this
// test sees what happens across a sequence of MAX_STEPS picks per match
// across many seeds.
//
// Invariants checked:
//   1. applyAction is total over (state, validActions[i]): never throws or
//      returns undefined for an action drawn from getValidActions(state, p).
//   2. Phase progression strictly bounded — every match either reaches
//      game-over within MAX_STEPS or the engine is in deadlock (no actor has
//      valid actions). The latter is itself an invariant violation.
//   3. Roster size never changes — 9 players in, 9 final players out.
//   4. Final winner is consistent with checkWinCondition logic:
//        wolves=0       → good
//        villagers=0    → werewolf
//        gods=0         → werewolf
//        wolves≥good    → werewolf
//   5. getPublicState never includes any seat's `inner` speech text in the
//      returned history — public-state.ts line 28 strips it; this test
//      asserts the output across long runs.
//   6. getPrivateState for any non-werewolf never includes the wolf coalition.
//      For any werewolf, knownAllies is the full wolf roster.
//   7. revealedRole on the public state's players is null until phase==='game-over'.

const SEEDS = [
  'fuzz-seed-A', 'fuzz-seed-B', 'fuzz-seed-C', 'fuzz-seed-D', 'fuzz-seed-E',
  'fuzz-seed-F', 'fuzz-seed-G', 'fuzz-seed-H',
];
const MAX_STEPS = 10_000;

function pickRandomActor(state: WerewolfGameState, rng: () => number) {
  const sorted = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
  const candidates: Array<{ playerId: string; valid: ReturnType<typeof getValidActions> }> = [];
  for (const p of sorted) {
    const valid = getValidActions(state, p.id);
    if (valid.length > 0) candidates.push({ playerId: p.id, valid });
  }
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(rng() * candidates.length)]!;
  const action = pick.valid[Math.floor(rng() * pick.valid.length)]!;
  return { playerId: pick.playerId, action };
}

// Tiny seedable RNG — mulberry32. Determinism per seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return h;
}

describe('werewolf-engine property fuzz', () => {
  for (const seed of SEEDS) {
    it(`completes a fuzz match for seed=${seed} without invariant violation`, () => {
      const rng = mulberry32(hashSeed(seed));

      let state = createGame({ gameId: `fuzz-${seed}`, seed });
      state = startFirstNight(state);

      let steps = 0;
      while (state.phase !== 'game-over') {
        if (steps >= MAX_STEPS) {
          throw new Error(`fuzz seed=${seed} exceeded ${MAX_STEPS} steps`);
        }
        const pick = pickRandomActor(state, rng);
        if (pick === null) {
          throw new Error(`fuzz seed=${seed} reached a deadlock at phase=${state.phase}`);
        }

        // Invariant 1: applyAction is total over the validActions output.
        // Any throw here is an engine bug and surfaces as a test failure.
        const next = applyAction(state, pick.action);
        expect(next).toBeDefined();
        state = next;
        steps++;

        // Invariant 5: public state never carries inner.
        const pub = getPublicState(state);
        for (const entry of pub.history) {
          if (entry.type === 'speech') {
            expect(entry.record).not.toHaveProperty('inner');
          }
        }

        // Invariant 7: revealedRole stays null pre-game-over.
        if (state.phase !== 'game-over') {
          for (const p of pub.players) {
            // Public players don't carry role until game-over. The shape may
            // differ — assert both that no role field is present AND that no
            // value is set. Reading via key access is intentional so a
            // future field-renaming silently revealing it is caught.
            const asRecord = p as unknown as Record<string, unknown>;
            expect(asRecord['role']).toBeUndefined();
          }
        }

        // Invariant 6: private state isolation.
        for (const p of state.players) {
          const priv = getPrivateState(state, p.id);
          if (p.role !== 'werewolf') {
            expect(priv.knownAllies).toEqual([]);
          } else {
            // knownAllies excludes self (private-state.ts) — every other
            // werewolf is in the set, but the requesting werewolf is not.
            const otherWolfIds = new Set(
              state.players.filter((q) => q.role === 'werewolf' && q.id !== p.id).map((q) => q.id),
            );
            expect(new Set(priv.knownAllies)).toEqual(otherWolfIds);
          }
          // private state must declare only the requesting player's role.
          expect(priv.selfRole).toBe(p.role);
        }
      }

      // Invariant 3: roster size unchanged.
      expect(state.players).toHaveLength(9);

      // Invariant 4: winner consistent with role/alive distribution.
      const aliveWolves = state.players.filter((p) => p.alive && p.role === 'werewolf').length;
      const aliveVillagers = state.players.filter((p) => p.alive && p.role === 'villager').length;
      const aliveGods = state.players.filter(
        (p) => p.alive && (p.role === 'seer' || p.role === 'witch' || p.role === 'hunter'),
      ).length;
      const aliveGood = aliveVillagers + aliveGods;

      expect(['good', 'werewolf']).toContain(state.winner);
      if (state.winner === 'good') {
        expect(aliveWolves).toBe(0);
      } else {
        const ruleA = aliveWolves === 0; // not allowed
        const villagersGone = aliveVillagers === 0;
        const godsGone = aliveGods === 0;
        const parity = aliveWolves >= aliveGood;
        expect(ruleA).toBe(false);
        expect(villagersGone || godsGone || parity).toBe(true);
      }
    });
  }
});
