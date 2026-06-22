import { PayableError, type PayableErrorOptions } from './payable-error';

export class ProviderNotFoundError extends PayableError {
  constructor(provider: string, options: PayableErrorOptions = {}) {
    super(`Payment provider not found: ${provider}`, {
      ...options,
      code: 'PROVIDER_NOT_FOUND',
      context: { provider, ...options.context },
    });
  }
}
