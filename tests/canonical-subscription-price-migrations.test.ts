import { afterEach, describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import {
  type MigrationPreviewDatabase,
  MIGRATION_NOW as NOW,
  migrationPreviewInput as previewInput,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

describe('canonical subscription price migration previews', () => {
  const databases: MigrationPreviewDatabase[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  const setup = () => setupMigrationPreview(databases);

  it('persists exact canonical snapshots and the provider financial preview', async () => {
    const { payable, provider, source, target, subscription, providerBinding } = await setup();

    const migration = await payable.subscriptionPriceMigrations(TENANT).preview({
      ...previewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });

    expect(migration).toMatchObject({
      tenantId: TENANT,
      subscriptionId: subscription.id,
      sourcePriceId: source.id,
      targetPriceId: target.id,
      sourcePrice: {
        id: source.id,
        productId: source.productId,
        amount: 1_000,
        currency: 'USD',
        interval: 'month',
        intervalCount: 1,
      },
      targetPrice: {
        id: target.id,
        productId: target.productId,
        amount: 2_000,
        currency: 'USD',
        interval: 'month',
        intervalCount: 1,
      },
      effectiveTiming: 'immediate',
      effectiveAt: null,
      immediateAdjustment: { direction: 'charge', amount: 500, currency: 'USD' },
      nextRenewal: { amount: 2_000, currency: 'USD', date: new Date('2026-09-25T00:00:00Z') },
      providerBindingId: providerBinding.id,
      status: 'previewed',
      attemptCount: 0,
      calculatedAt: NOW,
      expiresAt: new Date('2026-08-25T10:15:00.000Z'),
    });
    expect(migration.currentItems).toEqual([
      { id: expect.any(String), priceId: source.id, quantity: 1 },
    ]);
    expect(migration.sourcePrice).toEqual({
      id: source.id,
      productId: source.productId,
      amount: 1_000,
      currency: 'USD',
      interval: 'month',
      intervalCount: 1,
    });
    expect(migration.targetPrice).toEqual({
      id: target.id,
      productId: target.productId,
      amount: 2_000,
      currency: 'USD',
      interval: 'month',
      intervalCount: 1,
    });
    expect(migration.proposedItems).toEqual([
      { id: migration.currentItems[0]?.id, priceId: target.id, quantity: 1 },
    ]);
    expect(migration.requestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(provider.lastPreview?.currentItems[0]).toMatchObject({ priceId: 'price_source_remote' });
    expect(provider.lastPreview?.proposedItems[0]).toMatchObject({
      priceId: 'price_target_remote',
    });
  });

  it('uses the binding registry key for aliased routing and provider idempotency', async () => {
    const eu = await setupMigrationPreview(databases, 'stripe-eu');
    const us = await setupMigrationPreview(databases, 'stripe-us');

    await expect(
      eu.payable.subscriptionPriceMigrations(TENANT).preview({
        ...previewInput,
        subscriptionId: eu.subscription.id,
        targetPriceId: eu.target.id,
      }),
    ).resolves.toMatchObject({
      subscriptionId: eu.subscription.id,
      targetPriceId: eu.target.id,
    });
    await us.payable.subscriptionPriceMigrations(TENANT).preview({
      ...previewInput,
      subscriptionId: us.subscription.id,
      targetPriceId: us.target.id,
    });

    expect(eu.provider.lastPreviewContext?.idempotencyKey).not.toBe(
      us.provider.lastPreviewContext?.idempotencyKey,
    );
  });

  it.each([
    'cross-product',
    'cross-tenant',
  ] as const)('rejects a %s target before calling the provider', async (kind) => {
    const { payable, provider, subscription } = await setup();
    const tenantId = kind === 'cross-tenant' ? 'tenant_other' : TENANT;
    const product = await payable.products(tenantId).create({ name: `${kind} product` });
    const target = await payable.prices(tenantId).create({
      productId: product.id,
      unitAmount: Money.of(2_500, 'USD'),
      type: 'recurring',
      interval: 'month',
    });

    await expect(
      payable.subscriptionPriceMigrations(TENANT).preview({
        ...previewInput,
        subscriptionId: subscription.id,
        targetPriceId: target.id,
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_TARGET_INELIGIBLE' });
    expect(provider.previewCalls).toBe(0);
  });

  it('requires an active target', async () => {
    const { payable, provider, target, subscription } = await setup();
    await payable.prices(TENANT).archive(target.id);

    await expect(
      payable.subscriptionPriceMigrations(TENANT).preview({
        ...previewInput,
        subscriptionId: subscription.id,
        targetPriceId: target.id,
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_TARGET_INELIGIBLE' });
    expect(provider.previewCalls).toBe(0);
  });

  it.each([
    ['currency', Money.of(2_000, 'EUR'), 'month' as const],
    ['billing period', Money.of(2_000, 'USD'), 'year' as const],
  ])('rejects an unsupported %s change before calling the provider', async (_kind, money, interval) => {
    const { payable, provider, product, subscription } = await setup();
    const target = await payable.prices(TENANT).create({
      productId: product.id,
      unitAmount: money,
      type: 'recurring',
      interval,
    });

    await expect(
      payable.subscriptionPriceMigrations(TENANT).preview({
        ...previewInput,
        subscriptionId: subscription.id,
        targetPriceId: target.id,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED' });
    expect(provider.previewCalls).toBe(0);
  });

  it('rejects stale canonical source state before calling the provider', async () => {
    const { payable, provider, storage, target, subscription } = await setup();
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    if (!item) throw new Error('Expected canonical subscription item');
    await storage.subscriptionItems.updateById(
      subscription.id,
      item.id,
      { priceId: target.id },
      TENANT,
    );

    await expect(
      payable.subscriptionPriceMigrations(TENANT).preview({
        ...previewInput,
        subscriptionId: subscription.id,
        targetPriceId: target.id,
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_PREVIEW_STALE' });
    expect(provider.previewCalls).toBe(0);
  });

  it('rejects an orphaned cross-tenant canonical customer before calling the provider', async () => {
    const { database, payable, provider, target, subscription } = await setup();
    const foreignCustomer = await payable.customers(undefined, 'tenant_other').create({
      billableType: 'User',
      billableId: 'foreign-customer',
      email: 'foreign@example.com',
    });
    await database.raw('PRAGMA foreign_keys = OFF');
    await database('payable_subscriptions')
      .where({ id: subscription.id })
      .update({ customer_id: foreignCustomer.id });
    await database.raw('PRAGMA foreign_keys = ON');

    await expect(
      payable.subscriptionPriceMigrations(TENANT).preview({
        ...previewInput,
        subscriptionId: subscription.id,
        targetPriceId: target.id,
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_PREVIEW_STALE' });
    expect(provider.previewCalls).toBe(0);
  });

  it('replays the same request and conflicts when the keyed request changes', async () => {
    const { payable, provider, product, target, subscription, storage } = await setup();
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const input = { ...previewInput, subscriptionId: subscription.id, targetPriceId: target.id };
    const first = await resource.preview(input);
    const replay = await resource.preview(input);
    const changedTarget = await payable.prices(TENANT).create({
      productId: product.id,
      unitAmount: Money.of(3_000, 'USD'),
      type: 'recurring',
      interval: 'month',
    });
    await storage.priceProviderBindings.create({
      tenantId: TENANT,
      priceId: changedTarget.id,
      provider: 'stripe',
      providerPriceId: 'price_changed_remote',
    });

    expect(replay).toEqual(first);
    expect(provider.previewCalls).toBe(1);
    await expect(
      resource.preview({ ...input, targetPriceId: changedTarget.id }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(provider.previewCalls).toBe(1);
  });

  it('conflicts a replay when the canonical renewal boundary changes', async () => {
    const { payable, provider, storage, target, subscription } = await setup();
    const input = { ...previewInput, subscriptionId: subscription.id, targetPriceId: target.id };
    await payable.subscriptionPriceMigrations(TENANT).preview(input);
    await storage.subscriptions.update(
      subscription.id,
      { currentPeriodEnd: new Date('2026-10-25T00:00:00.000Z') },
      TENANT,
    );

    await expect(payable.subscriptionPriceMigrations(TENANT).preview(input)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(provider.previewCalls).toBe(1);
  });

  it('keeps retrieve and bounded list pages tenant scoped', async () => {
    const { payable, target, subscription } = await setup();
    const migration = await payable.subscriptionPriceMigrations(TENANT).preview({
      ...previewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });

    await expect(
      payable.subscriptionPriceMigrations(TENANT).retrieve(migration.id),
    ).resolves.toEqual(migration);
    await expect(
      payable.subscriptionPriceMigrations('tenant_other').retrieve(migration.id),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_NOT_FOUND' });
    await expect(payable.subscriptionPriceMigrations('tenant_other').list()).resolves.toEqual({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
    await expect(
      payable.subscriptionPriceMigrations(TENANT).list({ limit: 0 }),
    ).rejects.toMatchObject({ code: 'COLLECTION_LIMIT_INVALID' });
    await expect(
      payable.subscriptionPriceMigrations(TENANT).list({ subscriptionId: subscription.id }),
    ).resolves.toEqual({ items: [migration], hasMore: false, nextCursor: null });
  });
});
