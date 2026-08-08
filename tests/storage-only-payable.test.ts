import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

async function setupStorageOnly(tenantId: string | null = null) {
  const database = createTestDb();
  await migrate(database);
  const storage = new KnexStorageDriver(database, new FakeClock());
  const customer = await storage.customers.create({
    tenantId,
    billableType: 'Team',
    billableId: 'team_1',
    email: 'owner@example.com',
    name: 'Owner',
    metadata: null,
  });
  await storage.customerProviderBindings.create({
    customerId: customer.id,
    provider: 'stripe',
    providerCustomerId: 'cus_1',
  });
  const subscription = await storage.subscriptions.create({
    tenantId,
    customerId: customer.id,
    name: 'default',
    provider: 'stripe',
    providerSubscriptionId: 'sub_1',
    status: 'active',
    priceId: 'price_pro',
    quantity: 1,
    trialEndsAt: null,
    endsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
  });
  const payment = await storage.payments.create({
    tenantId,
    customerId: customer.id,
    provider: 'stripe',
    providerPaymentId: 'pi_1',
    status: 'succeeded',
    currency: 'USD',
    amount: 9900,
    refundedAmount: 0,
    reference: null,
    description: null,
  });
  return { customer, database, payment, storage, subscription };
}

describe('storage-only Payable', () => {
  it('lists canonical subscriptions and payments without resolving a provider', async () => {
    const { database, payment, storage, subscription } = await setupStorageOnly();
    const payable = createPayable({ storage });

    await expect(payable.subscriptions()).resolves.toEqual([subscription]);
    await expect(payable.payments()).resolves.toEqual([payment]);
    await expect(payable.subscription(subscription.id).retrieve()).resolves.toEqual(subscription);

    await database.destroy();
  });

  it('reads canonical customers without resolving a provider', async () => {
    const { customer, database, storage } = await setupStorageOnly();
    const payable = createPayable({ storage });

    await expect(payable.customers().find(customer.id)).resolves.toEqual(customer);
    await expect(payable.customers().list()).resolves.toMatchObject({ items: [customer] });

    await database.destroy();
  });

  it('preserves tenant requirements for local reads', async () => {
    const { database, storage } = await setupStorageOnly('tenant_a');
    const payable = createPayable({ storage, tenant: { enabled: true } });

    expect(() => payable.subscriptions()).toThrowError(
      expect.objectContaining({ code: 'TENANT_REQUIRED' }),
    );
    expect(() => payable.payments()).toThrowError(
      expect.objectContaining({ code: 'TENANT_REQUIRED' }),
    );
    await expect(payable.subscriptions('tenant_a')).resolves.toHaveLength(1);
    await expect(payable.payments('tenant_a')).resolves.toHaveLength(1);

    await database.destroy();
  });

  it.each(['', '   '])('rejects an empty tenant id for local reads', async (tenantId) => {
    const { database, storage } = await setupStorageOnly('tenant_a');
    const payable = createPayable({ storage, tenant: { enabled: true } });

    expect(() => payable.customers(undefined, tenantId)).toThrowError(
      expect.objectContaining({ code: 'TENANT_REQUIRED' }),
    );
    expect(() => payable.products(tenantId)).toThrowError(
      expect.objectContaining({ code: 'TENANT_REQUIRED' }),
    );
    expect(() => payable.canonicalSubscriptions(tenantId)).toThrowError(
      expect.objectContaining({ code: 'TENANT_REQUIRED' }),
    );
    expect(() => payable.storedPayments(tenantId)).toThrowError(
      expect.objectContaining({ code: 'TENANT_REQUIRED' }),
    );

    await database.destroy();
  });
});
