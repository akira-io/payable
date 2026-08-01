import { PayableError } from './payable-error';

export class PriceNotFoundError extends PayableError {
  constructor(providerPriceId: string) {
    super(`Price not found: ${providerPriceId}`, {
      code: 'PRICE_NOT_FOUND',
      context: { providerPriceId },
    });
  }
}
