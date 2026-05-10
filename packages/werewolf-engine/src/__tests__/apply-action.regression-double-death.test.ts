import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';

// Edge case: wolves vote to kill player X; the witch *skips* save (so X
// is on the death list) and then *poisons* player X as well. Witch
// wastes her poison. The engine's night-resolve at phases.ts:49 already
// guards against double-counting:
//
//   if (witchPoisoned && witchPoisoned !== killTarget) {
//     deaths.push({ id: witchPoisoned, cause: 'witch-poison' });
//   }
//
// So history records exactly ONE death entry — cause: 'wolf-kill', not
// witch-poison. Without this guard, downstream consumers (per-player
// death counters, invariant scanners, analytics aggregators) would see
// the same player die twice. This test pins the dedup so a future
// engine change can't silently re-introduce the duplicate.

describe('applyAction — wolf-kill + witch-poison on the same player', () => {
  it('records exactly one death (cause=wolf-kill); witch-poison is dedup-suppressed', () => {
    let s = createGame({ gameId: 'g-double-death', seed: 'seed-double-death' });
    s = startFirstNight(s);

    // Pick a victim: any villager. Get all wolves to vote for them.
    const victim = s.players.find((p) => p.role === 'villager')!;
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    for (const w of wolves) {
      s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: victim.id });
    }
    expect(s.phase).toBe('night-witch');
    // Witch confirms not saving, then poisons the SAME victim the wolves chose.
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-poison', targetId: victim.id });

    // Skip seer to advance through resolve.
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });

    // We're now past night-resolve. Either day-speeches (no hunter death) or
    // hunter-shoot (if victim happened to be the hunter — but we picked
    // a villager so this shouldn't fire).
    expect(['day-speeches', 'day-announce']).toContain(s.phase);

    const deathEntries = s.history.filter(
      (h): h is Extract<typeof h, { type: 'death' }> => h.type === 'death',
    );
    const victimDeaths = deathEntries.filter((d) => d.playerId === victim.id);

    // Pin the dedup at phases.ts:49 — only wolf-kill is recorded.
    expect(victimDeaths).toHaveLength(1);
    expect(victimDeaths[0]!.cause).toBe('wolf-kill');

    // Victim is dead exactly once.
    const victimAfter = s.players.find((p) => p.id === victim.id)!;
    expect(victimAfter.alive).toBe(false);
  });

  it('does not double-count alive→dead when the witch poisons the wolf-target', () => {
    // Same setup as above; assert the player count never inflates and
    // exactly one player is dead post-resolve. Belt-and-braces — guards
    // against a hypothetical future change that mistakenly removes the
    // duplicate guard in players.map (phases.ts:54).
    let s = createGame({ gameId: 'g-double-death-2', seed: 'seed-double-death-2' });
    s = startFirstNight(s);
    const victim = s.players.find((p) => p.role === 'villager')!;
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    for (const w of wolves) {
      s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: victim.id });
    }
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-poison', targetId: victim.id });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });

    expect(s.players).toHaveLength(9);
    const dead = s.players.filter((p) => !p.alive);
    expect(dead).toHaveLength(1);
    expect(dead[0]!.id).toBe(victim.id);
  });
});
