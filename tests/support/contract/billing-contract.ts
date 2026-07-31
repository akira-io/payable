import { expect, it } from 'vitest';
import { CONTRACT_BASE_TIME, type ContractContext } from './harness';

export function registerBillingContract(ctx: ContractContext): void {
  it('persists a logical customer and resolves its provider binding', async () => {
    const { storage } = ctx.harness();
    const created = await storage.customers.create({
      tenantId: null,
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
    const binding = await storage.customerProviderBindings.create({
      customerId: created.id,
      provider: 'stripe',
      providerCustomerId: 'cus_1',
    });
    const byProvider = await storage.customerProviderBindings.findByProviderId(
      'stripe',
      'cus_1',
      null,
    );
    const byCustomer = await storage.customerProviderBindings.findByCustomerAndProvider(
      created.id,
      'stripe',
      null,
    );

    expect(byId?.id).toBe(created.id);
    expect(byBillable?.id).toBe(created.id);
    expect(byProvider?.id).toBe(binding.id);
    expect(byCustomer?.id).toBe(binding.id);
    expect(byProvider?.customerId).toBe(created.id);
    expect(byId?.createdAt).toBeInstanceOf(Date);
  });

  it('updates a customer patch without clobbering other fields', async () => {
    const { storage } = ctx.harness();
    const created = await storage.customers.create({
      tenantId: null,
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
    expect(await storage.prices.listByProduct(product.id, null)).toHaveLength(1);
    expect(await storage.products.findByProviderId('stripe', 'prod_1', null)).not.toBeNull();
  });

  it('keeps catalog local identities inside their tenant partition', async () => {
    const { storage } = ctx.harness();
    const productA = await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerProductId: 'prod_tenant_a',
      name: 'Tenant A product',
      description: null,
      active: true,
      metadata: null,
    });
    const priceA = await storage.prices.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerPriceId: 'price_tenant_a',
      productId: productA.id,
      currency: 'usd',
      unitAmount: 1999,
      interval: 'month',
      intervalCount: 1,
      active: true,
    });

    expect(await storage.products.findById(productA.id, 'tenant-b')).toBeNull();
    expect(await storage.prices.findById(priceA.id, 'tenant-b')).toBeNull();
    expect(await storage.products.findById(productA.id, null)).toBeNull();
    expect(await storage.prices.findById(priceA.id, null)).toBeNull();
    expect(await storage.prices.listByProduct(productA.id, 'tenant-b')).toEqual([]);
  });

  it('persists subscriptions and their items', async () => {
    const { storage } = ctx.harness();
    const customer = await storage.customers.create({
      tenantId: null,
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
