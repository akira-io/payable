import { PayableError, type PayableErrorOptions } from './payable-error';

export class ProductNotFoundError extends PayableError {
  constructor(providerProductId: string, options: PayableErrorOptions = {}) {
    super(`Product not found: ${providerProductId}`, {
      ...options,
      code: 'PRODUCT_NOT_FOUND',
      context: { ...options.context, providerProductId },
    });
  }
}
