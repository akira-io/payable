import { PayableError } from '../errors/payable-error';

export function assertSubscriptionQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new PayableError(`Subscription quantity must be a positive integer, got ${quantity}`, {
      code: 'SUBSCRIPTION_INVALID_QUANTITY',
      context: { quantity },
    });
  }
}
