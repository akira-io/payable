import { PayableError, type PayableErrorOptions } from './payable-error';

export class CustomerNotFoundError extends PayableError {
  constructor(identifier: string, options: PayableErrorOptions = {}) {
    super(`Customer not found: ${identifier}`, {
      ...options,
      code: 'CUSTOMER_NOT_FOUND',
      context: { identifier, ...options.context },
    });
  }
}
