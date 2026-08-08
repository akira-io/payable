import type { StorageDriver } from '../../src/domain/contracts/storage-driver.contract';
import type { SubscriptionStatus } from '../../src/domain/value-objects/subscription-status';

export interface StoredSubscriptionOptions {
  tenantId?: string | null;
  billableId: string;
  provider: string;
  providerSubscriptionId: string | null;
  name?: string;
  priceId?: string;
  quantity?: number;
  status?: SubscriptionStatus;
  binding?: boolean;
  subscriptionBinding?: boolean;
}

export async function storeSubscription(
  storage: StorageDriver,
  options: StoredSubscriptionOptions,
) {
  const tenantId = options.tenantId ?? null;
  const customer = await storage.customers.create({
    tenantId,
    billableType: 'Team',
    billableId: options.billableId,
    email: `${options.billableId}@example.com`,
    name: options.billableId,
    metadata: null,
  });
  if (options.binding !== false) {
    await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: options.provider,
      providerCustomerId: `cus_${options.billableId}`,
    });
  }
  const subscription = await storage.subscriptions.create({
    tenantId,
    customerId: customer.id,
    name: options.name ?? 'default',
    provider: options.provider,
    providerSubscriptionId: options.providerSubscriptionId,
    status: options.status ?? 'active',
    priceId: options.priceId ?? 'price_old',
    quantity: options.quantity ?? 1,
    trialEndsAt: null,
    endsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
  });
  await storage.subscriptionItems.create({
    subscriptionId: subscription.id,
    priceId: options.priceId ?? 'price_old',
    providerItemId: null,
    quantity: subscription.quantity,
  });
  if (options.providerSubscriptionId && options.subscriptionBinding !== false) {
    await storage.subscriptionProviderBindings.create({
      tenantId,
      subscriptionId: subscription.id,
      provider: options.provider,
      providerSubscriptionId: options.providerSubscriptionId,
      providerSyncedAt: null,
    });
  }
  return { customer, subscription };
}
