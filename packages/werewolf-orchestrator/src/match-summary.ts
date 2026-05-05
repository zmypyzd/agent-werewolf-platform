import type {
  WerewolfGameState,
  WerewolfHistoryEntry,
  WerewolfPlayerId,
  WerewolfRole,
  WerewolfSide,
} from '@agent-poker/shared';

export interface WerewolfFinalPlayer {
  readonly id: WerewolfPlayerId;
  readonly seatIndex: number;
  readonly name: string;
  readonly role: WerewolfRole;
  readonly side: WerewolfSide;
  readonly alive: boolean;
}

export interface WerewolfMatchSummary {
  readonly gameId: string;
  readonly seed: string;
  readonly winner: WerewolfSide;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly nightCount: number;
  readonly dayCount: number;
  readonly finalPlayers: ReadonlyArray<WerewolfFinalPlayer>;
  readonly history: ReadonlyArray<WerewolfHistoryEntry>;
  readonly replayEventCount: number;
  readonly stepCount: number;
}

export interface BuildWerewolfMatchSummaryInput {
  readonly initialState: WerewolfGameState;
  readonly finalState: WerewolfGameState;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly replayEventCount: number;
  readonly stepCount: number;
}

export function buildWerewolfMatchSummary(
  input: BuildWerewolfMatchSummaryInput,
): WerewolfMatchSummary {
  const { finalState } = input;
  if (finalState.winner === null) {
    throw new Error(
      `buildWerewolfMatchSummary: finalState.winner is null (phase=${finalState.phase})`,
    );
  }
  const finalPlayers: WerewolfFinalPlayer[] = finalState.players.map((p) => ({
    id: p.id,
    seatIndex: p.seatIndex,
    name: p.name,
    role: p.role,
    side: p.side,
    alive: p.alive,
  }));
  return {
    gameId: finalState.gameId,
    seed: finalState.seed,
    winner: finalState.winner,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: input.completedAt - input.startedAt,
    nightCount: finalState.nightNumber,
    dayCount: finalState.dayNumber,
    finalPlayers,
    history: finalState.history,
    replayEventCount: input.replayEventCount,
    stepCount: input.stepCount,
  };
}
