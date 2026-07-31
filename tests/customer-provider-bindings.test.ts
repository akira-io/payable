import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('customer provider bindings', () => {
  it('keeps independent bindings when the same billable switches providers', async () => {
    const db = createTestDb();
    await migrate(db);
    const stripe = new FakeProvider('cus_stripe');
    const paddle = new FakeProvider('ctm_paddle');
    const payable = createPayable({
      providers: { stripe, paddle },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    const stripeCustomer = await payable.customers('stripe').create(billable);
    const paddleCustomer = await payable.customers('paddle').create(billable);
    await payable.customers('stripe').create(billable);

    expect(paddleCustomer.id).toBe(stripeCustomer.id);
    expect(await payable.customers('stripe').binding(billable)).toMatchObject({
      customerId: stripeCustomer.id,
      provider: 'stripe',
      providerCustomerId: 'cus_stripe',
    });
    expect(await payable.customers('paddle').binding(billable)).toMatchObject({
      customerId: stripeCustomer.id,
      provider: 'paddle',
      providerCustomerId: 'ctm_paddle',
    });
    expect(stripe.createCustomerCalls).toBe(1);
    expect(paddle.createCustomerCalls).toBe(1);
    await db.destroy();
  });

  it('uses registered provider keys for two accounts backed by the same adapter', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider('cus_shared_opaque_id');
    const payable = createPayable({
      providers: { 'stripe-eu': provider, 'stripe-us': provider },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    const customer = await payable.customers('stripe-eu').create(billable);
    await payable.customers('stripe-us').create(billable);

    expect(await payable.customers('stripe-eu').binding(billable)).toMatchObject({
      customerId: customer.id,
      provider: 'stripe-eu',
      providerCustomerId: 'cus_shared_opaque_id',
    });
    expect(await payable.customers('stripe-us').binding(billable)).toMatchObject({
      customerId: customer.id,
      provider: 'stripe-us',
      providerCustomerId: 'cus_shared_opaque_id',
    });
    expect(provider.createCustomerCalls).toBe(2);
    await db.destroy();
  });

  it('passes the selected binding to downstream checkout and invoice operations', async () => {
    const db = createTestDb();
    await migrate(db);
    const stripe = new FakeProvider('cus_stripe');
    const paddle = new FakeProvider('ctm_paddle');
    const payable = createPayable({
      providers: { stripe, paddle },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    await payable.customers('stripe').create(billable);
    await payable.customer(billable, 'paddle').redirectCheckout(Money.of(2500, 'USD')).create();
    await payable.customer(billable, 'paddle').invoices();

    expect(paddle.lastCheckout?.input.providerCustomerId).toBe('ctm_paddle');
    expect(paddle.lastListInvoices?.providerCustomerId).toBe('ctm_paddle');
    expect(stripe.lastCheckout).toBeUndefined();
    expect(stripe.lastListInvoices).toBeUndefined();
    await db.destroy();
  });

  it('converges on one logical customer and binding during concurrent creation', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });

    const customers = await Promise.all([
      payable.customers().create(billable),
      payable.customers().create(billable),
    ]);

    expect(customers[0]?.id).toBe(customers[1]?.id);
    expect(await payable.customers().binding(billable)).toMatchObject({
      customerId: customers[0]?.id,
      provider: 'stripe',
      providerCustomerId: 'cus_fake',
    });
    await db.destroy();
  });

  it('reports a coded persistence failure when a provider customer cannot be bound', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const originalBindings = storage.customerProviderBindings;
    storage.customerProviderBindings = {
      create: async () => {
        throw new Error('storage unavailable');
      },
      findByCustomerAndProvider: async () => null,
      findByProviderId: (...args) => originalBindings.findByProviderId(...args),
    };
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });

    await expect(payable.customers().create(billable)).rejects.toMatchObject({
      code: 'CUSTOMER_PROVIDER_BINDING_PERSISTENCE_FAILED',
      context: { provider: 'stripe', providerCustomerId: 'cus_fake' },
    });
    await db.destroy();
  });

  it('reports a coded conflict when a concurrent binding has a different provider id', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    let lookups = 0;
    storage.customerProviderBindings = {
      create: async () => {
        throw new Error('unique constraint');
      },
      findByCustomerAndProvider: async (customerId, provider) => {
        lookups += 1;
        if (lookups === 1) {
          return null;
        }
        return {
          id: 'binding-race-winner',
          customerId,
          provider,
          providerCustomerId: 'cus_other',
          createdAt: clock.now(),
          updatedAt: clock.now(),
        };
      },
      findByProviderId: async () => null,
    };
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });

    await expect(payable.customers().create(billable)).rejects.toMatchObject({
      code: 'CUSTOMER_PROVIDER_BINDING_CONFLICT',
      context: {
        provider: 'stripe',
        providerCustomerId: 'cus_fake',
        existingProviderCustomerId: 'cus_other',
      },
    });
    await db.destroy();
  });
});
