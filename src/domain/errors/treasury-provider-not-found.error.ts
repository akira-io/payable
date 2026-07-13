import { PayableError, type PayableErrorOptions } from './payable-error';

export class TreasuryProviderNotFoundError extends PayableError {
  constructor(provider: string, options: PayableErrorOptions = {}) {
    super(`Treasury provider not found: ${provider}`, {
      ...options,
      code: 'TREASURY_PROVIDER_NOT_FOUND',
      context: { provider, ...options.context },
    });
  }
}
