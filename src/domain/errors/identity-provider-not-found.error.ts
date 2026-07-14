import { PayableError, type PayableErrorOptions } from './payable-error';

export class IdentityProviderNotFoundError extends PayableError {
  constructor(provider: string, options: PayableErrorOptions = {}) {
    super(`Identity provider not found: ${provider}`, {
      ...options,
      code: 'IDENTITY_PROVIDER_NOT_FOUND',
      context: { provider, ...options.context },
    });
  }
}
