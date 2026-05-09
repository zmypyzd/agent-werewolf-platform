import {
  type WerewolfAction,
  type WerewolfGameState,
  type WerewolfPlayer,
  WEREWOLF_MAX_PK_ROUNDS,
  InvalidWerewolfActionError,
  WerewolfPhaseError,
} from '@agent-poker/shared';
import { computeWolfKillTarget } from './valid-actions.js';
import {
  resolveNightAndAdvance,
  advanceToNightSeer,
  advanceToNightWitch,
  startDayVote,
  startNextNight,
} from './phases.js';
import { checkWinCondition } from './win-condition.js';

function findPlayer(state: WerewolfGameState, id: string): WerewolfPlayer {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new InvalidWerewolfActionError(`unknown player ${id}`);
  return p;
}

function aliveWolves(state: WerewolfGameState): WerewolfPlayer[] {
  return state.players.filter((p) => p.alive && p.role === 'werewolf');
}

export function applyAction(state: WerewolfGameState, action: WerewolfAction): WerewolfGameState {
  switch (action.type) {
    case 'werewolf-vote':
      return applyWerewolfVote(state, action);
    case 'witch-save':
    case 'witch-skip-save':
    case 'witch-poison':
    case 'witch-skip-poison':
      return applyWitch(state, action);
    case 'seer-divine':
      return applySeerDivine(state, action);
    case 'speak':
      return applySpeak(state, action);
    case 'day-vote':
      return applyDayVote(state, action);
    case 'hunter-shoot':
      return applyHunterShoot(state, action);
  }
}

function applyWerewolfVote(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'werewolf-vote' }>,
): WerewolfGameState {
  if (state.phase !== 'night-werewolf-vote') {
    throw new WerewolfPhaseError(`cannot werewolf-vote in phase ${state.phase}`);
  }
  const voter = findPlayer(state, action.voterId);
  if (voter.role !== 'werewolf' || !voter.alive) {
    throw new InvalidWerewolfActionError(`only alive werewolves may werewolf-vote`);
  }
  const target = findPlayer(state, action.targetId);
  if (!target.alive) {
    throw new InvalidWerewolfActionError(`cannot target a dead player`);
  }
  if (target.role === 'werewolf') {
    throw new InvalidWerewolfActionError(`cannot target another werewolf`);
  }
  const next: WerewolfGameState = {
    ...state,
    pendingNight: {
      ...state.pendingNight,
      werewolfVotes: { ...state.pendingNight.werewolfVotes, [action.voterId]: action.targetId },
    },
  };
  const wolvesAlive = aliveWolves(next);
  const allVoted = wolvesAlive.every((w) => next.pendingNight.werewolfVotes[w.id] !== undefined);
  if (allVoted) {
    return advanceToNightWitch(next);
  }
  return next;
}

function applyWitch(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'witch-save' | 'witch-skip-save' | 'witch-poison' | 'witch-skip-poison' }>,
): WerewolfGameState {
  if (state.phase !== 'night-witch') {
    throw new WerewolfPhaseError(`cannot perform witch action in phase ${state.phase}`);
  }
  switch (action.type) {
    case 'witch-save': {
      if (!state.witchPotions.hasSave) throw new InvalidWerewolfActionError('save potion already used');
      if (state.pendingNight.witchSaveDecisionMade) {
        throw new InvalidWerewolfActionError('witch save decision already made this night');
      }
      if (state.pendingNight.witchSaved !== null || state.pendingNight.witchPoisoned !== null) {
        throw new InvalidWerewolfActionError('witch already acted this night');
      }
      const killTarget = computeWolfKillTarget(state.pendingNight.werewolfVotes);
      if (killTarget === null || action.targetId !== killTarget) {
        throw new InvalidWerewolfActionError('save must target the wolf-kill victim');
      }
      return {
        ...state,
        witchPotions: { ...state.witchPotions, hasSave: false },
        pendingNight: { ...state.pendingNight, witchSaveDecisionMade: true, witchSaved: action.targetId },
      };
    }
    case 'witch-skip-save': {
      if (state.pendingNight.witchSaveDecisionMade) {
        throw new InvalidWerewolfActionError('witch save decision already made this night');
      }
      // Records that the witch has explicitly skipped the save decision so the next
      // valid-actions call advances her into the poison sub-decision.
      return {
        ...state,
        pendingNight: { ...state.pendingNight, witchSaveDecisionMade: true },
      };
    }
    case 'witch-poison': {
      if (!state.pendingNight.witchSaveDecisionMade) {
        throw new InvalidWerewolfActionError('witch must make save decision before poisoning');
      }
      if (!state.witchPotions.hasPoison) throw new InvalidWerewolfActionError('poison potion already used');
      if (state.pendingNight.witchSaved !== null) {
        throw new InvalidWerewolfActionError('cannot save and poison same night');
      }
      const target = findPlayer(state, action.targetId);
      if (!target.alive) throw new InvalidWerewolfActionError('cannot poison a dead player');
      return advanceToNightSeer({
        ...state,
        witchPotions: { ...state.witchPotions, hasPoison: false },
        pendingNight: { ...state.pendingNight, witchPoisoned: action.targetId },
      });
    }
    case 'witch-skip-poison':
      if (!state.pendingNight.witchSaveDecisionMade) {
        throw new InvalidWerewolfActionError('witch must make save decision before skipping poison');
      }
      return advanceToNightSeer(state);
  }
}

function applySeerDivine(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'seer-divine' }>,
): WerewolfGameState {
  if (state.phase !== 'night-seer') {
    throw new WerewolfPhaseError(`cannot seer-divine in phase ${state.phase}`);
  }
  const seer = state.players.find((p) => p.role === 'seer' && p.alive);
  if (!seer) {
    throw new WerewolfPhaseError('no living seer');
  }
  const target = state.players.find((p) => p.id === action.targetId);
  if (!target || !target.alive || target.id === seer.id) {
    throw new InvalidWerewolfActionError('invalid seer target');
  }
  const next: WerewolfGameState = {
    ...state,
    phase: 'night-resolve',
    pendingNight: { ...state.pendingNight, seerTarget: target.id, seerResult: target.side },
  };
  return resolveNightAndAdvance(next);
}

function applySpeak(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'speak' }>,
): WerewolfGameState {
  if (state.phase !== 'day-speeches') throw new WerewolfPhaseError(`cannot speak in phase ${state.phase}`);
  const speaker = findPlayer(state, action.playerId);
  if (!speaker.alive) throw new InvalidWerewolfActionError('dead players cannot speak');
  if (state.pendingDaySpeeches.some((r) => r.playerId === action.playerId)) {
    throw new InvalidWerewolfActionError('player already spoke this day');
  }
  const next: WerewolfGameState = {
    ...state,
    pendingDaySpeeches: [
      ...state.pendingDaySpeeches,
      { playerId: action.playerId, inner: action.inner, performance: action.performance, speech: action.speech },
    ],
    history: [
      ...state.history,
      { type: 'speech', day: state.dayNumber, record: { playerId: action.playerId, inner: action.inner, performance: action.performance, speech: action.speech } },
    ],
  };
  const aliveCountNow = next.players.filter((p) => p.alive).length;
  if (next.pendingDaySpeeches.length === aliveCountNow) {
    return startDayVote(next);
  }
  return next;
}

function applyDayVote(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'day-vote' }>,
): WerewolfGameState {
  if (state.phase !== 'day-vote' || !state.pendingDayVote) {
    throw new WerewolfPhaseError(`cannot day-vote in phase ${state.phase}`);
  }
  const voter = findPlayer(state, action.voterId);
  if (!voter.alive) throw new InvalidWerewolfActionError('dead players cannot vote');
  if (state.pendingDayVote.votes.some((v) => v.voterId === action.voterId)) {
    throw new InvalidWerewolfActionError('voter already cast a ballot this round');
  }
  if (action.targetId !== null) {
    const target = findPlayer(state, action.targetId);
    if (!target.alive) throw new InvalidWerewolfActionError('cannot banish a dead player');
    if (target.id === voter.id) throw new InvalidWerewolfActionError('cannot vote for self');
    // PK-round target restriction: in pkRound>0 only the previous round's tied
    // top vote-getters (state.pendingDayVote.pkCandidates) are on the ballot.
    // Standard 9-player rules: the PK round narrows the choice to the tied top,
    // not "vote anyone again". Abstain (targetId===null) is always allowed.
    if (
      state.pendingDayVote.pkRound > 0 &&
      state.pendingDayVote.pkCandidates.length > 0 &&
      !state.pendingDayVote.pkCandidates.includes(action.targetId)
    ) {
      throw new InvalidWerewolfActionError(
        `target ${action.targetId} is not on the PK ballot`,
      );
    }
  }
  const updatedVotes = [...state.pendingDayVote.votes, { voterId: action.voterId, targetId: action.targetId }];
  const aliveIds = state.players.filter((p) => p.alive).map((p) => p.id);
  const everyoneVoted = updatedVotes.length === aliveIds.length;
  const previousCandidates = state.pendingDayVote.pkCandidates;
  let next: WerewolfGameState = {
    ...state,
    pendingDayVote: { ...state.pendingDayVote, votes: updatedVotes },
  };
  if (!everyoneVoted) return next;

  const tally: Record<string, number> = {};
  for (const v of updatedVotes) {
    if (v.targetId) tally[v.targetId] = (tally[v.targetId] ?? 0) + 1;
  }
  let banished: string | null = null;
  let topCount = 0;
  let tied = false;
  for (const [t, c] of Object.entries(tally)) {
    if (c > topCount) { banished = t; topCount = c; tied = false; }
    else if (c === topCount) { tied = true; }
  }
  // Plurality wins: the highest vote-getter is banished. PK is triggered only
  // when two or more players truly tie for the top (or when nobody received a
  // vote at all, i.e. all abstained — banished===null). The previous code
  // also forced PK when topCount<=aliveCount/2 ("no strict majority"), which
  // mislabelled clear pluralities (e.g. 4-3-2 of 9) as "tied" and surfaced a
  // misleading "票数相同" banner. Standard 9-player Werewolf rules are
  // plurality, not strict-majority, so that gate is removed.
  if (tied || banished === null) {
    // PK candidates for the next round = players tied at the top of THIS
    // round's tally. If everyone abstained (tally empty), preserve the prior
    // round's candidates so an abstain round doesn't accidentally widen the
    // ballot.
    const topTied = Object.entries(tally)
      .filter(([, c]) => c === topCount && topCount > 0)
      .map(([t]) => t);
    const nextCandidates: ReadonlyArray<string> =
      topTied.length > 0 ? topTied : previousCandidates;

    if (state.pendingDayVote.pkRound >= WEREWOLF_MAX_PK_ROUNDS) {
      const finalRecord = {
        votes: updatedVotes,
        tally,
        banished: null,
        pkRound: state.pendingDayVote.pkRound,
        tied: true,
        pkCandidates: previousCandidates,
      };
      next = {
        ...next,
        phase: 'day-resolve',
        pendingDayVote: finalRecord,
        history: [...next.history, { type: 'vote', day: next.dayNumber, record: finalRecord }],
      };
      return advanceFromDayResolve(next);
    }
    const pkRecord = {
      votes: [],
      tally,
      banished: null,
      pkRound: state.pendingDayVote.pkRound + 1,
      tied: true,
      pkCandidates: nextCandidates,
    };
    return {
      ...next,
      pendingDayVote: pkRecord,
      history: [
        ...next.history,
        {
          type: 'vote',
          day: next.dayNumber,
          record: {
            votes: updatedVotes,
            tally,
            banished: null,
            pkRound: state.pendingDayVote.pkRound,
            tied: true,
            pkCandidates: previousCandidates,
          },
        },
      ],
    };
  }

  const finalRecord = {
    votes: updatedVotes,
    tally,
    banished,
    pkRound: state.pendingDayVote.pkRound,
    tied: false,
    pkCandidates: previousCandidates,
  };
  next = {
    ...next,
    phase: 'day-resolve',
    pendingDayVote: finalRecord,
    history: [...next.history, { type: 'vote', day: next.dayNumber, record: finalRecord }],
  };
  return advanceFromDayResolve(next);
}

function advanceFromDayResolve(state: WerewolfGameState): WerewolfGameState {
  // Note: the resolved vote record was already appended to history by applyDayVote
  // before calling this helper. Do NOT push it again here.
  const banished = state.pendingDayVote?.banished ?? null;
  let players: WerewolfPlayer[] = state.players.map((p) => ({ ...p }));
  let history = [...state.history];
  if (banished) {
    players = players.map((p) => (p.id === banished ? { ...p, alive: false } : p));
    history.push({ type: 'death', day: state.dayNumber, playerId: banished, cause: 'banishment' });
  }
  const banishedPlayer = banished ? state.players.find((p) => p.id === banished) ?? null : null;
  let next: WerewolfGameState = { ...state, players, history };
  if (banishedPlayer && banishedPlayer.role === 'hunter') {
    next = { ...next, phase: 'hunter-shoot', pendingHunterShoot: { hunterId: banishedPlayer.id, cause: 'banishment' } };
    return next;
  }
  const winner = checkWinCondition({ ...next });
  if (winner) {
    return { ...next, phase: 'game-over', winner, history: [...next.history, { type: 'game-over', winner }] };
  }
  return startNextNight(next);
}

function applyHunterShoot(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'hunter-shoot' }>,
): WerewolfGameState {
  if (state.phase !== 'hunter-shoot' || !state.pendingHunterShoot) {
    throw new WerewolfPhaseError(`cannot hunter-shoot in phase ${state.phase}`);
  }
  const hunterId = state.pendingHunterShoot.hunterId;
  let players = state.players.map((p) => ({ ...p }));
  let history = [...state.history];
  if (action.targetId !== null) {
    const target = findPlayer(state, action.targetId);
    if (!target.alive) throw new InvalidWerewolfActionError('cannot shoot a dead player');
    if (target.id === hunterId) throw new InvalidWerewolfActionError('hunter cannot shoot self');
    players = players.map((p) => (p.id === target.id ? { ...p, alive: false } : p));
    history.push({ type: 'death', day: state.dayNumber, playerId: target.id, cause: 'hunter-shoot' });
  }
  history.push({ type: 'hunter-shoot', shooterId: hunterId, targetId: action.targetId });
  let next: WerewolfGameState = { ...state, players, history, pendingHunterShoot: null };

  const winner = checkWinCondition(next);
  if (winner) {
    return { ...next, phase: 'game-over', winner, history: [...next.history, { type: 'game-over', winner }] };
  }
  if (state.pendingHunterShoot.cause === 'banishment') {
    return startNextNight(next);
  }
  return { ...next, phase: 'day-speeches', pendingDaySpeeches: [] };
}
