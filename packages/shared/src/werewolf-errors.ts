import { AppError } from './errors.js';

export class InvalidWerewolfActionError extends AppError {
  constructor(reason: string) { super('WEREWOLF_INVALID_ACTION', reason); }
}

export class WerewolfPhaseError extends AppError {
  constructor(reason: string) { super('WEREWOLF_WRONG_PHASE', reason); }
}
