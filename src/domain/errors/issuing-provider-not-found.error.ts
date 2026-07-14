import { PayableError, type PayableErrorOptions } from './payable-error';

export class IssuingProviderNotFoundError extends PayableError {
  constructor(provider: string, options: PayableErrorOptions = {}) {
    super(`Issuing provider not found: ${provider}`, {
      ...options,
      code: 'ISSUING_PROVIDER_NOT_FOUND',
      context: { provider, ...options.context },
    });
  }
}
