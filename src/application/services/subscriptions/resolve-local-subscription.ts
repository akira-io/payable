import type { StorageDriver } from '../../../domain/contracts/storage-driver.contract';
import type { Customer } from '../../../domain/entities/customer.entity';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import { SubscriptionNotFoundError } from '../../../domain/errors/subscription-not-found.error';

export interface ResolvedLocalSubscription {
  subscription: Subscription;
  customer: Customer;
}

export async function resolveLocalSubscription(
  storage: StorageDriver,
  localId: string,
  tenantId: string | null,
): Promise<ResolvedLocalSubscription> {
  const subscription = await storage.subscriptions.findById(localId, tenantId);
  if (!subscription) {
    throw new SubscriptionNotFoundError(localId);
  }
  const customer = await storage.customers.findById(subscription.customerId, tenantId);
  if (!customer) {
    throw new SubscriptionNotFoundError(localId);
  }
  return {
    subscription,
    customer,
  };
}
