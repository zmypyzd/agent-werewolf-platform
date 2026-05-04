import type { WerewolfGameState, WerewolfSide } from '@agent-poker/shared';

export function checkWinCondition(state: WerewolfGameState): WerewolfSide | null {
  const alive = state.players.filter((p) => p.alive);
  const wolves = alive.filter((p) => p.role === 'werewolf');
  const villagers = alive.filter((p) => p.role === 'villager');
  const gods = alive.filter((p) => p.role === 'seer' || p.role === 'witch' || p.role === 'hunter');
  const good = villagers.length + gods.length;

  if (wolves.length === 0) return 'good';
  if (villagers.length === 0) return 'werewolf';
  if (gods.length === 0) return 'werewolf';
  if (wolves.length >= good) return 'werewolf';
  return null;
}
