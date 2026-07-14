import { PayableError, type PayableErrorOptions } from './payable-error';

export class AccountingProviderNotFoundError extends PayableError {
  constructor(provider: string, options: PayableErrorOptions = {}) {
    super(`Accounting provider not found: ${provider}`, {
      ...options,
      code: 'ACCOUNTING_PROVIDER_NOT_FOUND',
      context: { provider, ...options.context },
    });
  }
}
