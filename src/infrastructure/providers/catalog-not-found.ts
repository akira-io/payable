import type { OperationContext } from '../../domain/dtos/common.dto';
import type { PayableErrorOptions } from '../../domain/errors/payable-error';
import { PriceNotFoundError } from '../../domain/errors/price-not-found.error';
import { ProductNotFoundError } from '../../domain/errors/product-not-found.error';

export function createProductNotFoundFactory(providerProductId: string, ctx?: OperationContext) {
  return (options: PayableErrorOptions) =>
    new ProductNotFoundError(providerProductId, {
      ...options,
      correlationId: ctx?.correlationId,
    });
}

export function createPriceNotFoundFactory(providerPriceId: string, ctx?: OperationContext) {
  return (options: PayableErrorOptions) =>
    new PriceNotFoundError(providerPriceId, {
      ...options,
      correlationId: ctx?.correlationId,
    });
}
