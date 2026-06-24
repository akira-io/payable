import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { onGracePeriod, onTrial } from '../src/domain/entities/subscription-state';
import { IdempotencyConflictError } from '../src/domain/errors/idempotency-conflict.error';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };
const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-sub' };

describe('StripeProvider.createSubscription', () => {
  it('maps the subscription and forwards the idempotency key', async () => {
    const calls = new Map<string, { params: unknown; options: { idempotencyKey?: string } }>();
    const stripe = {
      subscriptions: {
        create: (params: unknown, options: { idempotencyKey?: string }) => {
          calls.set('create', { params, options });
          return Promise.resolve({
            id: 'sub_1',
            status: 'active',
            trial_end: null,
            items: { data: [{ id: 'si_1', current_period_end: 1753142400 }] },
          });
        },
      },
    } as unknown as Stripe;
    const provider = new StripeProvider({ secretKey: 'sk', webhookSecret: 'wh' }, stripe);

    const dto = await provider.createSubscription(
      { providerCustomerId: 'cus_1', priceId: 'price_1', quantity: 2 },
      ctx,
    );

    expect(dto.providerSubscriptionId).toBe('sub_1');
    expect(dto.status).toBe('active');
    expect(dto.currentPeriodEnd?.toISOString()).toBe(new Date(1753142400 * 1000).toISOString());
    expect(calls.get('create')?.options.idempotencyKey).toBe('idem-sub');
    expect(calls.get('create')?.params).toMatchObject({
      customer: 'cus_1',
      items: [{ price: 'price_1', quantity: 2 }],
    });
  });

  it('throws instead of sending an undefined item id when none exists', async () => {
    const stripe = {
      subscriptions: {
        retrieve: () => Promise.resolve({ items: { data: [] } }),
        update: () => Promise.resolve({ id: 'sub_1', status: 'active', items: { data: [] } }),
      },
    } as unknown as Stripe;
    const provider = new StripeProvider({ secretKey: 'sk', webhookSecret: 'wh' }, stripe);

    await expect(
      provider.updateSubscription({ providerSubscriptionId: 'sub_1', priceId: 'price_x' }, ctx),
    ).rejects.toMatchObject({ code: 'PROVIDER_SUBSCRIPTION_ITEM_MISSING' });
  });
});

describe('subscription lifecycle', () => {
  it('creates, swaps, cancels in grace, resumes, and cancels now', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(db, clock),
      clock,
    });
    const subscriptionOf = () => payable.customer(billable).subscription('default');

    const created = await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_pro')
      .trialDays(14)
      .create();
    expect(created.providerSubscriptionId).toBe('sub_fake');
    expect(created.status).toBe('trialing');
    expect(provider.createdSubscriptions).toBe(1);
    expect(onTrial(created, clock.now())).toBe(true);

    const swapped = await subscriptionOf().swap('price_business');
    expect(swapped.priceId).toBe('price_business');
    expect(provider.lastSubscriptionUpdate?.priceId).toBe('price_business');
    expect(provider.lastSubscriptionUpdateCtx?.idempotencyKey).toContain(':price_business');

    const quantity = await subscriptionOf().updateQuantity(3);
    expect(quantity.quantity).toBe(3);
    const keyAtThree = provider.lastSubscriptionUpdateCtx?.idempotencyKey;
    expect(keyAtThree).toContain('subscription:quantity:');
    expect(keyAtThree?.endsWith(':3')).toBe(true);

    await subscriptionOf().updateQuantity(5);
    expect(provider.lastSubscriptionUpdateCtx?.idempotencyKey).not.toBe(keyAtThree);

    const canceled = await subscriptionOf().cancel();
    expect(canceled.endsAt).not.toBeNull();
    expect(onGracePeriod(canceled, clock.now())).toBe(true);

    const resumed = await subscriptionOf().resume();
    expect(resumed.endsAt).toBeNull();

    const canceledNow = await subscriptionOf().cancelNow();
    expect(canceledNow.status).toBe('canceled');
    expect(canceledNow.endsAt?.toISOString()).toBe('2026-06-22T00:00:00.000Z');
    await db.destroy();
  });

  it('treats a create with the same key but different quantity as a conflict', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage,
      clock,
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });

    await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_pro')
      .quantity(1)
      .create();

    await expect(
      payable.customer(billable).newSubscription('default').price('price_pro').quantity(5).create(),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await db.destroy();
  });

  it('preserves quantity when swapping a subscription price', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });

    await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_pro')
      .quantity(3)
      .create();
    await payable.customer(billable).subscription('default').swap('price_business');

    expect(provider.lastSubscriptionUpdate?.quantity).toBe(3);
    await db.destroy();
  });

  it('rejects a non-positive or non-integer quantity', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const sub = payable.customer(billable).subscription('default');

    await expect(sub.updateQuantity(0)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_INVALID_QUANTITY',
    });
    await expect(sub.updateQuantity(-2)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_INVALID_QUANTITY',
    });
    await expect(sub.updateQuantity(1.5)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_INVALID_QUANTITY',
    });
    await db.destroy();
  });

  it('rejects management without storage', async () => {
    const payable = createPayable({ providers: { stripe: new FakeProvider() } });
    await expect(payable.customer(billable).subscription('default').cancel()).rejects.toThrow(
      'requires a storage driver',
    );
  });

  it('rejects management when the provider lacks the subscriptions capability', async () => {
    class NoSubscriptionsProvider extends FakeProvider {
      override capabilities() {
        return { ...super.capabilities(), subscriptions: false };
      }
    }
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({
      providers: { stripe: new NoSubscriptionsProvider() },
      storage,
    });
    await expect(payable.customer(billable).subscription('default').cancel()).rejects.toThrow(
      'subscriptions',
    );
    await db.destroy();
  });

  it('writes an audit log atomically when swapping a plan', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });

    const created = await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_pro')
      .create();
    await payable.customer(billable).subscription('default').swap('price_business');

    const logs = await storage.auditLogs.list({
      resourceType: 'subscription',
      resourceId: created.id,
    });
    expect(logs.some((log) => log.action === 'subscription.swapped')).toBe(true);
    await db.destroy();
  });

  it('scopes findByName to the owning tenant', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const customer = await storage.customers.create({
      tenantId: 'tenant-a',
      billableType: 'User',
      billableId: '1',
      provider: 'stripe',
      providerCustomerId: 'cus_a',
      email: 'a@example.com',
      name: 'A',
      metadata: null,
    });
    await storage.subscriptions.create({
      tenantId: 'tenant-a',
      customerId: customer.id,
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_a',
      status: 'active',
      priceId: 'price_pro',
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });

    expect(
      await storage.subscriptions.findByName(customer.id, 'default', 'tenant-a'),
    ).not.toBeNull();
    expect(await storage.subscriptions.findByName(customer.id, 'default', 'tenant-b')).toBeNull();
    await db.destroy();
  });
});
