import type {
  WerewolfGameState,
  WerewolfPlayerId,
  WerewolfPrivateState,
} from '@agent-poker/shared';
import { computeWolfKillTarget } from './valid-actions.js';

export function getPrivateState(state: WerewolfGameState, playerId: WerewolfPlayerId): WerewolfPrivateState {
  const self = state.players.find((p) => p.id === playerId);
  if (!self) {
    throw new Error(`unknown player ${playerId}`);
  }

  const knownAllies =
    self.role === 'werewolf'
      ? state.players.filter((p) => p.role === 'werewolf' && p.id !== self.id).map((p) => p.id)
      : [];

  const seerKnowledge =
    self.role === 'seer'
      ? state.history
          .filter((e): e is Extract<typeof e, { type: 'night-action' }> => e.type === 'night-action')
          .filter((e) => e.record.seerTarget !== null && e.record.seerResult !== null)
          .map((e) => ({ targetId: e.record.seerTarget!, side: e.record.seerResult! }))
      : [];

  const witchView =
    self.role === 'witch'
      ? {
          potions: state.witchPotions,
          currentNightKillTarget:
            state.phase === 'night-witch' ? computeWolfKillTarget(state.pendingNight.werewolfVotes) : null,
        }
      : null;

  const hunterCanShoot =
    self.role === 'hunter' &&
    state.phase === 'hunter-shoot' &&
    state.pendingHunterShoot?.hunterId === self.id;

  return {
    selfId: self.id,
    selfRole: self.role,
    selfSide: self.side,
    knownAllies,
    seerKnowledge,
    witchView,
    hunterCanShoot,
  };
}
