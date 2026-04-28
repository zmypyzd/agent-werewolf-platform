import type { HandSummary, PublicHandPlayerSummary, PublicHandSummary } from '@agent-poker/shared';

type MaybePrivateHandPlayerSummary = PublicHandPlayerSummary & {
  holeCards?: unknown;
  handEvaluation?: unknown;
};

type MaybePrivateHandSummary = Omit<HandSummary, 'players'> & {
  players: MaybePrivateHandPlayerSummary[];
};

export function publicHandSummary(summary: HandSummary): PublicHandSummary;
export function publicHandSummary(summary: PublicHandSummary): PublicHandSummary;
export function publicHandSummary(summary: MaybePrivateHandSummary): PublicHandSummary {
  return {
    ...summary,
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
