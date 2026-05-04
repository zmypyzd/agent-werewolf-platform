import {
  type WerewolfGameState,
  type WerewolfPlayer,
  type WerewolfHistoryEntry,
  WEREWOLF_TOTAL_PLAYERS,
  WEREWOLF_ROLE_DISTRIBUTION,
  WEREWOLF_ROLE_TO_SIDE,
  WEREWOLF_NAME_POOL,
} from '@agent-poker/shared';
import { createSeededRng, shuffle } from './prng.js';
import { emptyPendingNight } from './phases.js';

export interface CreateGameInput {
  readonly gameId: string;
  readonly seed: string;
}

export function createGame(input: CreateGameInput): WerewolfGameState {
  const rng = createSeededRng(`${input.seed}-roles`);
  const shuffledRoles = shuffle(WEREWOLF_ROLE_DISTRIBUTION, rng);
  const shuffledNames = shuffle(WEREWOLF_NAME_POOL, createSeededRng(`${input.seed}-names`));

  const players: WerewolfPlayer[] = [];
  const history: WerewolfHistoryEntry[] = [];
  for (let i = 0; i < WEREWOLF_TOTAL_PLAYERS; i++) {
    const role = shuffledRoles[i]!;
    const name = shuffledNames[i]!;
    const id = `p${i + 1}`;
    players.push({
      id,
      seatIndex: i,
      name,
      role,
      side: WEREWOLF_ROLE_TO_SIDE[role],
      alive: true,
    });
    history.push({ type: 'role-assigned', playerId: id, role });
  }

  return {
    gameId: input.gameId,
    seed: input.seed,
    phase: 'setup',
    nightNumber: 0,
    dayNumber: 0,
    players,
    witchPotions: { hasSave: true, hasPoison: true },
    pendingNight: emptyPendingNight(),
    pendingDaySpeeches: [],
    pendingDayVote: null,
    pendingHunterShoot: null,
    history,
    winner: null,
  };
}
