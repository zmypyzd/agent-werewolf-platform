import type {
  WerewolfAction,
  WerewolfGameState,
  WerewolfPlayer,
  WerewolfPlayerId,
} from '@agent-poker/shared';

function aliveNonSelf(players: ReadonlyArray<WerewolfPlayer>, selfId: WerewolfPlayerId): WerewolfPlayer[] {
  return players.filter((p) => p.alive && p.id !== selfId);
}

function aliveNonWolves(players: ReadonlyArray<WerewolfPlayer>): WerewolfPlayer[] {
  return players.filter((p) => p.alive && p.role !== 'werewolf');
}

export function getValidActions(state: WerewolfGameState, playerId: WerewolfPlayerId): WerewolfAction[] {
  const self = state.players.find((p) => p.id === playerId);
  if (!self) return [];

  // hunter-shoot is the only phase where a dead player still acts.
  if (state.phase === 'hunter-shoot') {
    if (!state.pendingHunterShoot || state.pendingHunterShoot.hunterId !== self.id) return [];
    const out: WerewolfAction[] = [{ type: 'hunter-shoot', targetId: null }];
    for (const t of aliveNonSelf(state.players, self.id)) {
      out.push({ type: 'hunter-shoot', targetId: t.id });
    }
    return out;
  }

  // For every other phase, dead players have no actions.
  if (!self.alive) return [];

  switch (state.phase) {
    case 'setup':
    case 'night-resolve':
    case 'day-announce':
    case 'day-resolve':
    case 'game-over':
      return [];

    case 'night-werewolf-vote': {
      if (self.role !== 'werewolf') return [];
      // Return empty if this werewolf has already cast their vote this night.
      if (state.pendingNight.werewolfVotes[self.id] !== undefined) return [];
      return aliveNonWolves(state.players).map((t) => ({
        type: 'werewolf-vote',
        voterId: self.id,
        targetId: t.id,
      }));
    }

    case 'night-witch': {
      if (self.role !== 'witch') return [];
      const out: WerewolfAction[] = [];
      const killTarget = computeWolfKillTarget(state.pendingNight.werewolfVotes);
      if (!state.pendingNight.witchSaveDecisionMade) {
        if (state.witchPotions.hasSave && killTarget) {
          out.push({ type: 'witch-save', targetId: killTarget });
        }
        out.push({ type: 'witch-skip-save' });
      } else {
        // Save decision is made; offer poison only if the witch didn't save this night.
        if (state.witchPotions.hasPoison && state.pendingNight.witchSaved === null) {
          for (const t of aliveNonSelf(state.players, self.id)) {
            out.push({ type: 'witch-poison', targetId: t.id });
          }
        }
        out.push({ type: 'witch-skip-poison' });
      }
      return out;
    }

    case 'night-seer': {
      if (self.role !== 'seer') return [];
      return aliveNonSelf(state.players, self.id).map((t) => ({
        type: 'seer-divine',
        targetId: t.id,
      }));
    }

    case 'day-speeches': {
      // Filter already-spoke players to keep getValidActions consistent with applyAction's guard.
      if (state.pendingDaySpeeches.some((r) => r.playerId === self.id)) return [];
      return [{
        type: 'speak',
        playerId: self.id,
        inner: '',
        performance: '',
        speech: '',
      }];
    }

    case 'day-vote': {
      // Filter already-voted players for the same reason.
      if (state.pendingDayVote?.votes.some((v) => v.voterId === self.id)) return [];
      const out: WerewolfAction[] = [{ type: 'day-vote', voterId: self.id, targetId: null }];
      // PK-round target restriction: in pkRound>0, only the players still on
      // the PK ballot (pkCandidates) are valid targets. Self-vote is always
      // disallowed; abstain is always allowed (the empty-targetId entry above).
      const pkRound = state.pendingDayVote?.pkRound ?? 0;
      const pkCandidates = state.pendingDayVote?.pkCandidates ?? [];
      const eligible =
        pkRound > 0 && pkCandidates.length > 0
          ? aliveNonSelf(state.players, self.id).filter((t) => pkCandidates.includes(t.id))
          : aliveNonSelf(state.players, self.id);
      for (const t of eligible) {
        out.push({ type: 'day-vote', voterId: self.id, targetId: t.id });
      }
      return out;
    }
  }
}

export function computeWolfKillTarget(
  votes: Readonly<Record<WerewolfPlayerId, WerewolfPlayerId>>,
): WerewolfPlayerId | null {
  const tally: Record<WerewolfPlayerId, number> = {};
  for (const target of Object.values(votes)) {
    tally[target] = (tally[target] ?? 0) + 1;
  }
  let best: WerewolfPlayerId | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [target, count] of Object.entries(tally)) {
    if (count > bestCount) {
      best = target;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? null : best;
}
