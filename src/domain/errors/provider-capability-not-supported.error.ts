import { PayableError, type PayableErrorOptions } from './payable-error';

export class ProviderCapabilityNotSupportedError extends PayableError {
  constructor(provider: string, capability: string, options: PayableErrorOptions = {}) {
    super(`Provider '${provider}' does not support capability: ${capability}`, {
      ...options,
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      context: { provider, capability, ...options.context },
    });
  }
}
