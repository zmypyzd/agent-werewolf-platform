import type {
  WerewolfGameState,
  WerewolfHistoryEntry,
  WerewolfPlayer,
  WerewolfPlayerId,
  WerewolfRole,
  PendingNightActions,
  NightActionRecord,
} from '@agent-poker/shared';
import { computeWolfKillTarget } from './valid-actions.js';
import { checkWinCondition } from './win-condition.js';

function isRoleAlive(state: WerewolfGameState, role: WerewolfRole): boolean {
  return state.players.some((p) => p.alive && p.role === role);
}

export function advanceToNightWitch(state: WerewolfGameState): WerewolfGameState {
  if (isRoleAlive(state, 'witch')) return { ...state, phase: 'night-witch' };
  return advanceToNightSeer(state);
}

export function advanceToNightSeer(state: WerewolfGameState): WerewolfGameState {
  if (isRoleAlive(state, 'seer')) return { ...state, phase: 'night-seer' };
  // No seer alive → resolve night immediately.
  return resolveNightAndAdvance({ ...state, phase: 'night-resolve' });
}

export function startFirstNight(state: WerewolfGameState): WerewolfGameState {
  return {
    ...state,
    phase: 'night-werewolf-vote',
    nightNumber: state.nightNumber + 1,
    pendingNight: emptyPendingNight(),
  };
}

export function emptyPendingNight(): PendingNightActions {
  return { werewolfVotes: {}, witchSaveDecisionMade: false, witchSaved: null, witchPoisoned: null, seerTarget: null, seerResult: null };
}

export function resolveNightAndAdvance(state: WerewolfGameState): WerewolfGameState {
  const killTarget = computeWolfKillTarget(state.pendingNight.werewolfVotes);
  const { witchSaved, witchPoisoned } = state.pendingNight;
  const deaths: { id: WerewolfPlayerId; cause: 'wolf-kill' | 'witch-poison' }[] = [];

  if (killTarget && killTarget !== witchSaved) {
    deaths.push({ id: killTarget, cause: 'wolf-kill' });
  }
  if (witchPoisoned && witchPoisoned !== killTarget /* avoid double-counting */) {
    deaths.push({ id: witchPoisoned, cause: 'witch-poison' });
  }

  const players: WerewolfPlayer[] = state.players.map((p) =>
    deaths.some((d) => d.id === p.id) ? { ...p, alive: false } : p,
  );
  const dayNumber = state.dayNumber + 1;
  const history: WerewolfHistoryEntry[] = [
    ...state.history,
    {
      type: 'night-action',
      night: state.nightNumber,
      record: {
        werewolfTarget: killTarget,
        witchSaved: state.pendingNight.witchSaved,
        witchPoisoned: state.pendingNight.witchPoisoned,
        seerTarget: state.pendingNight.seerTarget,
        seerResult: state.pendingNight.seerResult,
      } satisfies NightActionRecord,
    },
    ...deaths.map((d) => ({ type: 'death' as const, day: dayNumber, playerId: d.id, cause: d.cause })),
  ];

  let next: WerewolfGameState = {
    ...state,
    phase: 'day-announce',
    dayNumber,
    players,
    history,
    pendingNight: emptyPendingNight(),
  };

  // Hunter detour: hunter killed by wolves shoots BEFORE day-announce.
  // v1 house rule: witch-poisoned hunter loses the shot — cause must be 'wolf-kill'.
  const hunterDeath = deaths.find((d) =>
    d.cause === 'wolf-kill' && state.players.find((p) => p.id === d.id)?.role === 'hunter',
  );
  if (hunterDeath) {
    next = {
      ...next,
      phase: 'hunter-shoot',
      pendingHunterShoot: { hunterId: hunterDeath.id, cause: 'wolf-kill' },
    };
  }

  const winner = checkWinCondition(next);
  if (winner) {
    return {
      ...next,
      phase: 'game-over',
      winner,
      pendingHunterShoot: null,
      history: [...next.history, { type: 'game-over', winner }],
    };
  }

  if (next.phase === 'day-announce') {
    next = dayAnnounceAndAdvance(next);
  }
  return next;
}

export function dayAnnounceAndAdvance(state: WerewolfGameState): WerewolfGameState {
  return { ...state, phase: 'day-speeches', pendingDaySpeeches: [] };
}

export function startDayVote(state: WerewolfGameState): WerewolfGameState {
  return {
    ...state,
    phase: 'day-vote',
    pendingDayVote: { votes: [], tally: {}, banished: null, pkRound: 0, tied: false, pkCandidates: [] },
  };
}

export function startNextNight(state: WerewolfGameState): WerewolfGameState {
  return {
    ...state,
    phase: 'night-werewolf-vote',
    nightNumber: state.nightNumber + 1,
    pendingDaySpeeches: [],
    pendingDayVote: null,
    pendingNight: emptyPendingNight(),
  };
}
