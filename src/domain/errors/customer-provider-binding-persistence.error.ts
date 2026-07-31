import { PayableError, type PayableErrorOptions } from './payable-error';

export class CustomerProviderBindingPersistenceError extends PayableError {
  constructor(provider: string, providerCustomerId: string, options: PayableErrorOptions = {}) {
    super(`Failed to persist customer provider binding for ${provider}`, {
      ...options,
      code: 'CUSTOMER_PROVIDER_BINDING_PERSISTENCE_FAILED',
      context: { provider, providerCustomerId, ...options.context },
    });
  }
}
