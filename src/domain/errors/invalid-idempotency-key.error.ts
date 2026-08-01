import { PayableError } from './payable-error';

export class InvalidIdempotencyKeyError extends PayableError {
  constructor(reason?: string) {
    super(reason ? `Invalid idempotency key: ${reason}` : 'Invalid idempotency key', {
      code: 'INVALID_IDEMPOTENCY_KEY',
    });
  }
}
