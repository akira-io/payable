import { PayableError, type PayableErrorOptions } from './payable-error';

export class MarketplaceProviderNotFoundError extends PayableError {
  constructor(provider: string, options: PayableErrorOptions = {}) {
    super(`Marketplace provider not found: ${provider}`, {
      ...options,
      code: 'MARKETPLACE_PROVIDER_NOT_FOUND',
      context: { provider, ...options.context },
    });
  }
}
