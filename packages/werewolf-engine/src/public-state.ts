import type {
  WerewolfGameState,
  WerewolfHistoryEntry,
  WerewolfPublicHistoryEntry,
  WerewolfPublicState,
} from '@agent-poker/shared';

export function getPublicState(state: WerewolfGameState): WerewolfPublicState {
  const reveal = state.phase === 'game-over';
  return {
    gameId: state.gameId,
    phase: state.phase,
    nightNumber: state.nightNumber,
    dayNumber: state.dayNumber,
    players: state.players.map((p) => ({
      id: p.id,
      seatIndex: p.seatIndex,
      name: p.name,
      alive: p.alive,
      revealedRole: reveal ? p.role : null,
    })),
    history: state.history
      .filter((e): e is Exclude<WerewolfHistoryEntry, { type: 'role-assigned' | 'night-action' }> =>
        e.type !== 'role-assigned' && e.type !== 'night-action',
      )
      .map((e): WerewolfPublicHistoryEntry => {
        if (e.type === 'speech') {
          const { inner: _inner, ...recordWithoutInner } = e.record;
          return { type: 'speech', day: e.day, record: recordWithoutInner };
        }
        return e;
      }),
    winner: state.winner,
  };
}
