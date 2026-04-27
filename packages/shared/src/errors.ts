export class AppError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export class InvalidActionError extends AppError {
  constructor(reason: string) { super('INVALID_ACTION', reason); }
}

export class AgentTimeoutError extends AppError {
  constructor(agentId: string, requestId: string) {
    super('AGENT_TIMEOUT', `Agent ${agentId} timed out on request ${requestId}`);
  }
}

export class TableFullError extends AppError {
  constructor(tableId: string) { super('TABLE_FULL', `Table ${tableId} is full`); }
}

export class HandInProgressError extends AppError {
  constructor(tableId: string) { super('HAND_IN_PROGRESS', `Table ${tableId} has a hand in progress`); }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) { super('NOT_FOUND', `${resource} ${id} not found`); }
}

export class NotEnoughPlayersError extends AppError {
  constructor(count: number) { super('NOT_ENOUGH_PLAYERS', `Need at least 2 players, have ${count}`); }
}

export class NotImplementedError extends AppError {
  constructor(feature: string) { super('NOT_IMPLEMENTED', `${feature} is not implemented in Phase 1`); }
}

export class InvalidConfigError extends AppError {
  constructor(reason: string) { super('INVALID_CONFIG', reason); }
}

export class SchemaValidationError extends AppError {
  constructor(details: string) { super('SCHEMA_VALIDATION_FAILED', `Schema validation failed: ${details}`); }
}

export class EmailTakenError extends AppError {
  constructor(email: string) { super('EMAIL_TAKEN', `Email ${email} is already registered`); }
}

export class ForbiddenError extends AppError {
  constructor(reason: string) { super('FORBIDDEN', reason); }
}

export class SeatTakenError extends AppError {
  constructor(tableId: string, seatIndex: number) {
    super('SEAT_TAKEN', `Seat ${seatIndex} at table ${tableId} is already occupied`);
  }
}

// Distinct from InvalidActionError (400) — used when the action *shape* is fine
// but it doesn't match the current turn (no pending request, wrong handId, etc).
export class ActionConflictError extends AppError {
  constructor(reason: string) { super('ACTION_CONFLICT', reason); }
}

export class AgentInUseError extends AppError {
  constructor(agentConfigId: string) {
    super('AGENT_IN_USE', `Agent config ${agentConfigId} is currently sat at a table`);
  }
}

export class RateLimitedError extends AppError {
  constructor(public readonly retryAfterMs: number) {
    super('RATE_LIMITED', `rate limit exceeded; retry after ${retryAfterMs}ms`);
  }
}
