import { PayableError, type PayableErrorOptions } from './payable-error';

export class TaxProviderNotFoundError extends PayableError {
  constructor(provider: string, options: PayableErrorOptions = {}) {
    super(`Tax provider not found: ${provider}`, {
      ...options,
      code: 'TAX_PROVIDER_NOT_FOUND',
      context: { provider, ...options.context },
    });
  }
}
