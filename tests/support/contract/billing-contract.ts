import { expect, it } from 'vitest';
import { CONTRACT_BASE_TIME, type ContractContext } from './harness';

export function registerBillingContract(ctx: ContractContext): void {
  it('persists a customer with metadata and resolves it three ways', async () => {
    const { storage } = ctx.harness();
    const created = await storage.customers.create({
      tenantId: null,
      provider: 'stripe',
      providerCustomerId: 'cus_1',
      billableType: 'User',
      billableId: '1',
      email: 'user@example.com',
      name: 'Ada',
      metadata: { plan: 'pro' },
    });

    expect(created.id).toBeTruthy();
    expect(created.metadata).toEqual({ plan: 'pro' });

    const byId = await storage.customers.findById(created.id);
    const byBillable = await storage.customers.findByBillable('User', '1');
    const byProvider = await storage.customers.findByProviderId('stripe', 'cus_1');

    expect(byId?.id).toBe(created.id);
    expect(byBillable?.id).toBe(created.id);
    expect(byProvider?.id).toBe(created.id);
    expect(byId?.createdAt).toBeInstanceOf(Date);
  });

  it('updates a customer patch without clobbering other fields', async () => {
    const { storage } = ctx.harness();
    const created = await storage.customers.create({
      tenantId: null,
      provider: 'stripe',
      providerCustomerId: null,
      billableType: 'User',
      billableId: '2',
      email: 'old@example.com',
      name: null,
      metadata: null,
    });

    const updated = await storage.customers.update(created.id, { email: 'new@example.com' });
    expect(updated.email).toBe('new@example.com');
    expect(updated.billableId).toBe('2');
  });

  it('links products and prices', async () => {
    const { storage } = ctx.harness();
    const product = await storage.products.create({
      tenantId: null,
      provider: 'stripe',
      providerProductId: 'prod_1',
      name: 'Pro',
      description: null,
      active: true,
      metadata: null,
    });
    const price = await storage.prices.create({
      tenantId: null,
      provider: 'stripe',
      providerPriceId: 'price_1',
      productId: product.id,
      currency: 'usd',
      unitAmount: 1999,
      interval: 'month',
      intervalCount: 1,
      active: true,
    });

    expect(price.currency).toBe('USD');
    expect(price.unitAmount).toBe(1999);
    expect(await storage.prices.listByProduct(product.id)).toHaveLength(1);
    expect(await storage.products.findByProviderId('stripe', 'prod_1')).not.toBeNull();
  });

  it('persists subscriptions and their items', async () => {
    const { storage } = ctx.harness();
    const customer = await storage.customers.create({
      tenantId: null,
      provider: 'stripe',
      providerCustomerId: 'cus_sub',
      billableType: 'User',
      billableId: '9',
      email: 'sub@example.com',
      name: null,
      metadata: null,
    });
    const subscription = await storage.subscriptions.create({
      tenantId: null,
      customerId: customer.id,
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
      status: 'active',
      priceId: null,
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: CONTRACT_BASE_TIME,
      currentPeriodEnd: CONTRACT_BASE_TIME,
    });

    await storage.subscriptionItems.createMany([
      { subscriptionId: subscription.id, priceId: 'price_a', providerItemId: 'si_a', quantity: 1 },
    ]);
    await storage.subscriptionItems.updatePrimary(subscription.id, { quantity: 4 });

    const items = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(4);
    expect(await storage.subscriptions.findByName(customer.id, 'default')).not.toBeNull();
    expect(await storage.subscriptions.findByProviderId('stripe', 'sub_1')).not.toBeNull();
  });
}
