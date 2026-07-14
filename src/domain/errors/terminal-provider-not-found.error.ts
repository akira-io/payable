import { PayableError, type PayableErrorOptions } from './payable-error';

export class TerminalProviderNotFoundError extends PayableError {
  constructor(provider: string, options: PayableErrorOptions = {}) {
    super(`Terminal provider not found: ${provider}`, {
      ...options,
      code: 'TERMINAL_PROVIDER_NOT_FOUND',
      context: { provider, ...options.context },
    });
  }
}
