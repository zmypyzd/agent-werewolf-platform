import { AppError } from '@agent-poker/shared';

export class UnauthenticatedError extends AppError {
  constructor(reason = 'authentication required') {
    super('UNAUTHENTICATED', reason);
  }
}

export class CsrfError extends AppError {
  constructor(reason = 'CSRF check failed') {
    super('CSRF_FAILED', reason);
  }
}
