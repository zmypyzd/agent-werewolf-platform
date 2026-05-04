import {
  type WerewolfAction,
  type WerewolfGameState,
  type WerewolfPlayer,
  InvalidWerewolfActionError,
  WerewolfPhaseError,
} from '@agent-poker/shared';
import { computeWolfKillTarget } from './valid-actions.js';
import { resolveNightAndAdvance, advanceToNightSeer, advanceToNightWitch } from './phases.js';

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
    case 'day-vote':
    case 'hunter-shoot':
      throw new WerewolfPhaseError(`action ${action.type} handled in Task 6`);
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
        pendingNight: { ...state.pendingNight, witchSaved: action.targetId },
      };
    }
    case 'witch-skip-save':
      // marker only; no state change beyond moving on (pendingNight.witchSaved stays null).
      // Return a new object (rather than the input reference) so callers using
      // identity equality to detect transitions still see a change.
      return { ...state };
    case 'witch-poison': {
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
