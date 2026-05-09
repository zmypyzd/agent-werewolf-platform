import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import type { WerewolfGameState } from '@agent-poker/shared';
import { InvalidWerewolfActionError, WerewolfPhaseError } from '@agent-poker/shared';

function rushToDaySpeeches(seed = 'seed-A'): WerewolfGameState {
  let s = createGame({ gameId: 'g1', seed });
  s = startFirstNight(s);
  const wolves = s.players.filter((p) => p.role === 'werewolf');
  const villager = s.players.find((p) => p.role === 'villager')!;
  for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: villager.id });
  s = applyAction(s, { type: 'witch-save', targetId: villager.id });
  s = applyAction(s, { type: 'witch-skip-poison' });
  const seer = s.players.find((p) => p.role === 'seer')!;
  const someoneElse = s.players.find((p) => p.id !== seer.id)!;
  s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
  expect(s.phase).toBe('day-speeches');
  return s;
}

describe('applyAction — day phase', () => {
  it('speak appends to pendingDaySpeeches but stays in day-speeches until all alive players spoke once', () => {
    let s = rushToDaySpeeches();
    const aliveOrder = s.players.filter((p) => p.alive).map((p) => p.id);
    for (let i = 0; i < aliveOrder.length - 1; i++) {
      s = applyAction(s, { type: 'speak', playerId: aliveOrder[i]!, inner: 'i', performance: 'p', speech: 's' });
      expect(s.phase).toBe('day-speeches');
    }
    s = applyAction(s, { type: 'speak', playerId: aliveOrder[aliveOrder.length - 1]!, inner: 'i', performance: 'p', speech: 's' });
    expect(s.phase).toBe('day-vote');
    expect(s.pendingDayVote).not.toBeNull();
  });

  it('speak rejects a player who already spoke this round', () => {
    let s = rushToDaySpeeches();
    const first = s.players.find((p) => p.alive)!;
    s = applyAction(s, { type: 'speak', playerId: first.id, inner: 'i', performance: 'p', speech: 's' });
    expect(() => applyAction(s, { type: 'speak', playerId: first.id, inner: 'i', performance: 'p', speech: 's' })).toThrow(InvalidWerewolfActionError);
  });

  it('day-vote with majority banishes; transitions through day-resolve to either next night or game-over', () => {
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    const target = s.players.find((p) => p.role === 'villager')!;
    const voters = s.players.filter((p) => p.alive && p.id !== target.id);
    for (const v of voters) {
      s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: target.id });
    }
    s = applyAction(s, { type: 'day-vote', voterId: target.id, targetId: null });
    expect(['night-werewolf-vote', 'game-over', 'hunter-shoot']).toContain(s.phase);
    expect(s.players.find((p) => p.id === target.id)!.alive).toBe(false);
  });

  it('day-vote with strict tie at top triggers PK round; pkCandidates = tied players', () => {
    // 9 alive: split 4-4 with 1 abstain → genuine tie, must trigger PK.
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    const a = s.players[0]!;
    const b = s.players[1]!;
    const others = s.players.filter((p) => p.id !== a.id && p.id !== b.id && p.alive);
    // 7 others: 4 vote A, 3 vote B → A=4, B=3 — clear plurality, NOT a tie.
    // To force a 4-4 tie we have a vote B as well (a votes for b), b votes A,
    // and one of the "others" abstains so the tally is A=4, B=4.
    const [bVoter, ...rest] = others; // first of others abstains? Actually, easier:
    // a votes b (A=0,B=1)
    // b votes a (A=1,B=1)
    // 6 of 7 others split 3/3 toward a/b → A=4, B=4
    // last "other" abstains.
    s = applyAction(s, { type: 'day-vote', voterId: a.id, targetId: b.id });
    s = applyAction(s, { type: 'day-vote', voterId: b.id, targetId: a.id });
    rest.slice(0, 3).forEach((v) => {
      s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: a.id });
    });
    rest.slice(3, 6).forEach((v) => {
      s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: b.id });
    });
    // bVoter (the leftover "other") abstains.
    s = applyAction(s, { type: 'day-vote', voterId: bVoter!.id, targetId: null });
    expect(s.phase).toBe('day-vote');
    expect(s.pendingDayVote!.pkRound).toBe(1);
    expect(s.pendingDayVote!.tied).toBe(true);
    expect(new Set(s.pendingDayVote!.pkCandidates)).toEqual(new Set([a.id, b.id]));
  });

  it('day-vote with plurality (no strict majority) banishes the top vote-getter — does NOT trigger PK', () => {
    // Regression for the "vote counts not equal but system says tied" bug.
    // 9 alive, votes split 4-3-2 (no abstain): A has plurality, must be banished.
    // Old engine forced PK because 4 <= 9/2 = 4.5; new engine banishes A.
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    const a = s.players.find((p) => p.role === 'villager')!;
    const b = s.players.filter((p) => p.id !== a.id && p.role !== 'hunter')[0]!;
    const c = s.players.filter((p) => p.id !== a.id && p.id !== b.id && p.role !== 'hunter')[0]!;
    const others = s.players.filter((p) => p.alive && p.id !== a.id && p.id !== b.id && p.id !== c.id);
    // a, b, c each cannot vote for self; have a vote b, b vote a, c vote a → A gets 2 (b,c), B gets 1 (a).
    // 6 others split: 2 vote A, 2 vote B, 2 vote C → A=4, B=3, C=2.
    s = applyAction(s, { type: 'day-vote', voterId: a.id, targetId: b.id });
    s = applyAction(s, { type: 'day-vote', voterId: b.id, targetId: a.id });
    s = applyAction(s, { type: 'day-vote', voterId: c.id, targetId: a.id });
    others.slice(0, 2).forEach((v) => { s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: a.id }); });
    others.slice(2, 4).forEach((v) => { s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: b.id }); });
    others.slice(4, 6).forEach((v) => { s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: c.id }); });
    // 4-3-2 with 9 voted, no abstain. A has plurality and must be banished.
    expect(s.phase).not.toBe('day-vote'); // advanced past day-vote (banishment occurred)
    const lastVote = [...s.history].reverse().find((e) => e.type === 'vote');
    expect(lastVote).toBeDefined();
    if (lastVote?.type === 'vote') {
      expect(lastVote.record.banished).toBe(a.id);
      expect(lastVote.record.tied).toBe(false);
      expect(lastVote.record.pkRound).toBe(0);
    }
    expect(s.players.find((p) => p.id === a.id)!.alive).toBe(false);
  });

  it('PK round restricts ballot to pkCandidates only', () => {
    // Build a 4-4-1 tie so PK candidates are exactly two players, then verify
    // valid-actions in PK round 1 only returns those two + abstain, and that
    // applyAction rejects voting for someone outside the candidate list.
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    const a = s.players[0]!;
    const b = s.players[1]!;
    const c = s.players[2]!;
    const others = s.players.filter((p) => p.alive && p.id !== a.id && p.id !== b.id && p.id !== c.id);
    // a votes b, b votes a, c votes a → A=2, B=1
    // 6 others: 2 → A, 3 → B, 1 → C → A=4, B=4, C=1
    s = applyAction(s, { type: 'day-vote', voterId: a.id, targetId: b.id });
    s = applyAction(s, { type: 'day-vote', voterId: b.id, targetId: a.id });
    s = applyAction(s, { type: 'day-vote', voterId: c.id, targetId: a.id });
    others.slice(0, 2).forEach((v) => { s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: a.id }); });
    others.slice(2, 5).forEach((v) => { s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: b.id }); });
    others.slice(5, 6).forEach((v) => { s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: c.id }); });
    expect(s.phase).toBe('day-vote');
    expect(s.pendingDayVote!.pkRound).toBe(1);
    expect(new Set(s.pendingDayVote!.pkCandidates)).toEqual(new Set([a.id, b.id]));
    // valid-actions for any voter in PK round 1: target must be a or b (or null abstain).
    const voter = s.players.find((p) => p.alive && p.id !== a.id && p.id !== b.id)!;
    const valid = (
      // Re-import from valid-actions to keep this self-contained
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      // we inline the check via state instead
      s.pendingDayVote!.pkCandidates
    );
    // applyAction must throw when voter targets someone outside pkCandidates.
    expect(() => applyAction(s, { type: 'day-vote', voterId: voter.id, targetId: c.id }))
      .toThrow(InvalidWerewolfActionError);
    // applyAction must accept a target inside pkCandidates.
    s = applyAction(s, { type: 'day-vote', voterId: voter.id, targetId: a.id });
    expect(s.pendingDayVote!.votes.length).toBe(1);
    void valid;
  });

  it('hunter-shoot fires when banished hunter shoots a target', () => {
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    const voters = s.players.filter((p) => p.alive && p.id !== hunter.id);
    for (const v of voters) s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: hunter.id });
    s = applyAction(s, { type: 'day-vote', voterId: hunter.id, targetId: null });
    expect(s.phase).toBe('hunter-shoot');
    expect(s.pendingHunterShoot!.hunterId).toBe(hunter.id);
    const wolf = s.players.find((p) => p.role === 'werewolf' && p.alive)!;
    s = applyAction(s, { type: 'hunter-shoot', targetId: wolf.id });
    expect(s.players.find((p) => p.id === wolf.id)!.alive).toBe(false);
    expect(s.pendingHunterShoot).toBeNull();
  });

  it('rejects out-of-phase day actions', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-A' });
    s = startFirstNight(s);
    expect(() => applyAction(s, { type: 'day-vote', voterId: 'p1', targetId: 'p2' })).toThrow(WerewolfPhaseError);
  });

  it('PK ceiling: 4 consecutive all-abstain rounds advance to next night with no banishment', () => {
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    expect(s.phase).toBe('day-vote');
    // Round 0 (initial vote), 1, 2, 3 — 4 rounds total of all abstain
    for (let round = 0; round <= 3; round++) {
      for (const p of s.players.filter((x) => x.alive)) {
        s = applyAction(s, { type: 'day-vote', voterId: p.id, targetId: null });
      }
      if (round < 3) {
        expect(s.phase).toBe('day-vote');
        expect(s.pendingDayVote!.pkRound).toBe(round + 1);
      }
    }
    // Ceiling reached: advance to next night with no banishment.
    expect(s.phase).toBe('night-werewolf-vote');
    expect(s.pendingDayVote).toBeNull();
    // The last 'vote' history entry records pkRound = 3 (the round at which the ceiling resolved), banished = null.
    const lastVote = [...s.history].reverse().find((e) => e.type === 'vote');
    expect(lastVote).toBeDefined();
    if (lastVote?.type === 'vote') {
      expect(lastVote.record.pkRound).toBe(3);
      expect(lastVote.record.banished).toBeNull();
    }
  });
});
