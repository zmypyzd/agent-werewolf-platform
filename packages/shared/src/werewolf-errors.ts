import { AppError } from './errors.js';

export class InvalidWerewolfActionError extends AppError {
  constructor(reason: string) { super('WEREWOLF_INVALID_ACTION', reason); }
}

export class WerewolfPhaseError extends AppError {
  constructor(reason: string) { super('WEREWOLF_WRONG_PHASE', reason); }
}

export class WerewolfGameNotFoundError extends AppError {
  constructor(gameId: string) {
    super('WEREWOLF_GAME_NOT_FOUND', `Werewolf game ${gameId} not found`);
  }
}

export class WerewolfSeatOccupiedError extends AppError {
  constructor(gameId: string, seatIndex: number) {
    super(
      'WEREWOLF_SEAT_OCCUPIED',
      `Seat ${seatIndex} in game ${gameId} is already occupied`,
    );
  }
}

export class WerewolfGameNotReadyError extends AppError {
  constructor(gameId: string, currentStatus: string) {
    super(
      'WEREWOLF_GAME_NOT_READY',
      `Game ${gameId} is in status '${currentStatus}'; cannot start`,
    );
  }
}

export class WerewolfGameAlreadyStartedError extends AppError {
  constructor(gameId: string) {
    super(
      'WEREWOLF_GAME_ALREADY_STARTED',
      `Game ${gameId} has already been started`,
    );
  }
}
