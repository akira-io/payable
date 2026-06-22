import { PayableError, type PayableErrorOptions } from './payable-error';

export class SubscriptionNotFoundError extends PayableError {
  constructor(identifier: string, options: PayableErrorOptions = {}) {
    super(`Subscription not found: ${identifier}`, {
      ...options,
      code: 'SUBSCRIPTION_NOT_FOUND',
      context: { identifier, ...options.context },
    });
  }
}
