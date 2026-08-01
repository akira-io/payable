import { PayableError, type PayableErrorOptions } from './payable-error';

export class IdempotencyResultPersistenceError extends PayableError {
  constructor(key: string, options: PayableErrorOptions = {}) {
    super(`Failed to persist idempotency result for key: ${key}`, {
      ...options,
      code: 'IDEMPOTENCY_RESULT_PERSISTENCE_FAILED',
      context: { key, ...options.context },
    });
  }
}
