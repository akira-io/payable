import { PayableError, type PayableErrorOptions } from './payable-error';

export class IdempotencyInProgressError extends PayableError {
  constructor(key: string, options: PayableErrorOptions = {}) {
    super(`Operation already in progress for idempotency key: ${key}`, {
      ...options,
      code: 'IDEMPOTENCY_IN_PROGRESS',
      context: { key, ...options.context },
    });
  }
}
