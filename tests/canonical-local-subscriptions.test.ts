import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

describe('canonical local subscriptions', () => {
  it('creates an incomplete subscription without resolving a provider', async () => {
    const database = createTestDb();
    await migrate(database);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(database, clock);
    const payable = createPayable({ storage });
    const customer = await payable.customers().create({
      billableType: 'Team',
      billableId: 'team_local',
      email: 'owner@example.com',
    });
    const product = await payable.products().create({ name: 'Local Pro' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
      intervalCount: 1,
    });

    const subscription = await payable.canonicalSubscriptions().create({
      customerId: customer.id,
      name: 'default',
      priceId: price.id,
      quantity: 2,
      activation: { state: 'pending' },
      collectionResponsibility: 'merchant',
      source: 'sdk',
    });

    expect(subscription).toMatchObject({
      tenantId: null,
      customerId: customer.id,
      name: 'default',
      provider: null,
      providerSubscriptionId: null,
      status: 'incomplete',
      canonicalPriceId: price.id,
      canonicalProductId: product.id,
      acceptedCurrency: 'EUR',
      acceptedUnitAmount: 2900,
      acceptedInterval: 'month',
      acceptedIntervalCount: 1,
      acceptedQuantity: 2,
      collectionResponsibility: 'merchant',
      creationSource: 'sdk',
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    const [outbox] = await database('payable_outbox_events').where({
      event_type: 'subscription.created.v1',
    });
    expect(JSON.parse(outbox?.payload as string)).toMatchObject({
      source: 'sdk',
      tenantId: null,
      acceptedTerms: {
        canonicalPriceId: price.id,
        canonicalProductId: product.id,
        currency: 'EUR',
        unitAmount: 2900,
        interval: 'month',
        intervalCount: 1,
        quantity: 2,
      },
      lifecycle: {
        transition: 'created',
        status: 'incomplete',
        collectionResponsibility: 'merchant',
      },
    });

    await database.destroy();
  });

  it('derives an active renewal boundary from the immutable recurring terms', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage });
    const customer = await payable.customers().create({
      billableType: 'Team',
      billableId: 'team_active',
      email: 'active@example.com',
    });
    const product = await payable.products().create({ name: 'Monthly Pro' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(1900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });

    const subscription = await payable.canonicalSubscriptions().create({
      customerId: customer.id,
      name: 'active',
      priceId: price.id,
      activation: { state: 'active', startsAt: new Date('2024-01-31T10:30:00.000Z') },
      collectionResponsibility: 'merchant',
      source: 'sdk',
    });

    expect(subscription.status).toBe('active');
    expect(subscription.currentPeriodStart).toEqual(new Date('2024-01-31T10:30:00.000Z'));
    expect(subscription.currentPeriodEnd).toEqual(new Date('2024-02-29T10:30:00.000Z'));
    expect(subscription.trialEndsAt).toBeNull();
    await database.destroy();
  });

  it('uses explicit trial boundaries and rejects an invalid trial', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage });
    const customer = await payable.customers().create({
      billableType: 'Team',
      billableId: 'team_trial',
      email: 'trial@example.com',
    });
    const product = await payable.products().create({ name: 'Trial Pro' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const startsAt = new Date('2024-03-01T00:00:00.000Z');
    const trialEndsAt = new Date('2024-03-15T00:00:00.000Z');

    const subscription = await payable.canonicalSubscriptions().create({
      customerId: customer.id,
      name: 'trial',
      priceId: price.id,
      activation: { state: 'trialing', startsAt, trialEndsAt },
      collectionResponsibility: 'merchant',
      source: 'api',
    });
    expect(subscription).toMatchObject({
      status: 'trialing',
      currentPeriodStart: startsAt,
      currentPeriodEnd: trialEndsAt,
      trialEndsAt,
    });

    await expect(
      payable.canonicalSubscriptions().create({
        customerId: customer.id,
        name: 'invalid-trial',
        priceId: price.id,
        activation: { state: 'trialing', startsAt, trialEndsAt: startsAt },
        collectionResponsibility: 'merchant',
        source: 'api',
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_TRIAL_INVALID' });
    await database.destroy();
  });

  it('returns the same local identity for an exact retry and rejects changed terms', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage });
    const customer = await payable.customers().create({
      billableType: 'Team',
      billableId: 'team_retry',
      email: 'retry@example.com',
    });
    const product = await payable.products().create({ name: 'Retry Pro' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(2500, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const input = {
      customerId: customer.id,
      name: 'default',
      priceId: price.id,
      quantity: 1,
      activation: { state: 'pending' as const },
      collectionResponsibility: 'merchant' as const,
      source: 'sdk',
    };

    const first = await payable.canonicalSubscriptions().create(input);
    const retry = await payable.canonicalSubscriptions().create(input);
    expect(retry.id).toBe(first.id);
    await expect(
      payable.canonicalSubscriptions().create({ ...input, quantity: 2 }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_IDENTITY_CONFLICT' });
    await expect(
      payable.canonicalSubscriptions().create({ ...input, source: 'import' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_IDENTITY_CONFLICT' });
    await database.destroy();
  });

  it('converges concurrent retries on one subscription and one creation transition', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage });
    const customer = await payable.customers().create({
      billableType: 'Team',
      billableId: 'team_concurrent',
      email: 'concurrent@example.com',
    });
    const product = await payable.products().create({ name: 'Concurrent Pro' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(3000, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const create = () =>
      payable.canonicalSubscriptions().create({
        customerId: customer.id,
        name: 'default',
        priceId: price.id,
        activation: { state: 'pending' },
        collectionResponsibility: 'merchant',
        source: 'api',
      });

    const subscriptions = await Promise.all([create(), create(), create(), create()]);
    expect(new Set(subscriptions.map(({ id }) => id))).toHaveLength(1);
    expect(await storage.subscriptions.list()).toHaveLength(1);
    const audit = await storage.auditLogs.list({
      resourceType: 'subscription',
      actions: ['subscription.created'],
    });
    expect(audit).toHaveLength(1);
    expect(
      await database('payable_outbox_events').where({ event_type: 'subscription.created.v1' }),
    ).toHaveLength(1);
    await database.destroy();
  });

  it('rejects archived and one-time prices before writing a subscription', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage });
    const customer = await payable.customers().create({
      billableType: 'Team',
      billableId: 'team_prices',
      email: 'prices@example.com',
    });
    const product = await payable.products().create({ name: 'Validation Pro' });
    const archived = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(1000, 'EUR'),
      type: 'recurring',
      interval: 'month',
      active: false,
    });
    const oneTime = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(5000, 'EUR'),
      type: 'one_time',
    });
    const base = {
      customerId: customer.id,
      name: 'invalid',
      activation: { state: 'pending' as const },
      collectionResponsibility: 'merchant' as const,
      source: 'sdk',
    };

    await expect(
      payable.canonicalSubscriptions().create({ ...base, priceId: archived.id }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_PRICE_INACTIVE' });
    await expect(
      payable.canonicalSubscriptions().create({ ...base, priceId: oneTime.id }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_PRICE_NOT_RECURRING' });
    expect(await storage.subscriptions.list()).toHaveLength(0);
    await database.destroy();
  });
});
