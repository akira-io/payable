import { PayableError, type PayableErrorOptions } from './payable-error';

export class CustomerProviderBindingConflictError extends PayableError {
  constructor(
    provider: string,
    providerCustomerId: string,
    existingProviderCustomerId: string,
    options: PayableErrorOptions = {},
  ) {
    super(`Customer provider binding conflict for ${provider}`, {
      ...options,
      code: 'CUSTOMER_PROVIDER_BINDING_CONFLICT',
      context: {
        provider,
        providerCustomerId,
        existingProviderCustomerId,
        ...options.context,
      },
    });
  }
}
