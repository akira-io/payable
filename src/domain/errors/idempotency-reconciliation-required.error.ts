import { PayableError } from './payable-error';

export class IdempotencyReconciliationRequiredError extends PayableError {
  constructor(key: string) {
    super(`Idempotency reconciliation required for key: ${key}`, {
      code: 'IDEMPOTENCY_RECONCILIATION_REQUIRED',
      context: { key },
    });
  }
}
