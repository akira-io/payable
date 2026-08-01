import { PayableError, type PayableErrorOptions } from './payable-error';

export class PriceNotFoundError extends PayableError {
  constructor(providerPriceId: string, options: PayableErrorOptions = {}) {
    super(`Price not found: ${providerPriceId}`, {
      ...options,
      code: 'PRICE_NOT_FOUND',
      context: { ...options.context, providerPriceId },
    });
  }
}
