import type { HandSummary, PublicHandPlayerSummary, PublicHandSummary } from '@agent-poker/shared';

type MaybePrivateHandPlayerSummary = PublicHandPlayerSummary & {
  holeCards?: unknown;
  handEvaluation?: unknown;
};

type MaybePrivateHandSummary = Omit<HandSummary, 'players' | 'seed'> & {
  seed?: unknown;
  players: MaybePrivateHandPlayerSummary[];
};

export function publicHandSummary(summary: HandSummary): PublicHandSummary;
export function publicHandSummary(summary: PublicHandSummary): PublicHandSummary;
export function publicHandSummary(summary: MaybePrivateHandSummary): PublicHandSummary {
  return {
    handId: summary.handId,
    tableId: summary.tableId,
    handNumber: summary.handNumber,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
    blindConfig: summary.blindConfig,
    communityCards: summary.communityCards,
    allActions: summary.allActions,
    results: summary.results,
    finalPots: summary.finalPots,
    players: summary.players.map(player => {
      const {
        holeCards: _holeCards,
        handEvaluation: _handEvaluation,
        ...publicPlayer
      } = player;
      return publicPlayer;
    }),
  };
}

export function publicHandSummaries(summaries: HandSummary[]): PublicHandSummary[] {
  return summaries.map(publicHandSummary);
}
