import { PayableError, type PayableErrorOptions } from './payable-error';

export class IdempotencyConflictError extends PayableError {
  constructor(key: string, options: PayableErrorOptions = {}) {
    super(`Idempotency key reused with a different request: ${key}`, {
      ...options,
      code: 'IDEMPOTENCY_CONFLICT',
      context: { key, ...options.context },
    });
  }
}
