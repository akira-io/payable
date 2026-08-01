import { PayableError } from './payable-error';

export class ProductNotFoundError extends PayableError {
  constructor(providerProductId: string) {
    super(`Product not found: ${providerProductId}`, {
      code: 'PRODUCT_NOT_FOUND',
      context: { providerProductId },
    });
  }
}
