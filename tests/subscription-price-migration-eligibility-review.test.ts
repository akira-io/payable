import { afterEach, describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import {
  type MigrationPreviewDatabase,
  MigrationPreviewProvider,
  migrationPreviewInput,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

describe('subscription price migration reviewed eligibility', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('allows a quantity-only migration from an archived historical source', async () => {
    const { payable, provider, source, storage, subscription } =
      await setupMigrationPreview(databases);
    await payable.prices(TENANT).archive(source.id);

    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'archived-source-quantity',
      subscriptionId: subscription.id,
      targetPriceId: source.id,
      quantity: 3,
    });
    expect(preview).toMatchObject({
      sourcePriceId: source.id,
      targetPriceId: source.id,
      proposedItems: [{ quantity: 3 }],
    });
    await expect(
      resource.approve(preview.id, { idempotencyKey: 'archived-source-quantity-apply' }),
    ).resolves.toMatchObject({ status: 'applied' });
    await expect(
      storage.subscriptionItems.listBySubscription(subscription.id, TENANT),
    ).resolves.toMatchObject([{ priceId: source.id, quantity: 3 }]);
    expect(provider.previewCalls).toBe(1);
    expect(provider.applyCalls).toBe(1);
  });

  it.each([
    ['currency', true, false, Money.of(2_000, 'EUR'), 'month' as const],
    ['billing period', false, true, Money.of(2_000, 'USD'), 'year' as const],
  ])('allows a %s change only when the provider explicitly advertises it', async (_kind, supportsCurrency, supportsBillingPeriod, money, interval) => {
    const provider = new MigrationPreviewProvider();
    provider.supportsCurrencyChange = supportsCurrency;
    provider.supportsBillingPeriodChange = supportsBillingPeriod;
    const { payable, product, storage, subscription } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const target = await payable.prices(TENANT).create({
      productId: product.id,
      unitAmount: money,
      type: 'recurring',
      interval,
    });
    await storage.priceProviderBindings.create({
      tenantId: TENANT,
      priceId: target.id,
      provider: 'stripe',
      providerPriceId: `price_${_kind.replace(' ', '_')}_remote`,
    });

    await expect(
      payable.subscriptionPriceMigrations(TENANT).preview({
        ...migrationPreviewInput,
        idempotencyKey: `supported-${_kind}`,
        subscriptionId: subscription.id,
        targetPriceId: target.id,
      }),
    ).resolves.toMatchObject({ targetPriceId: target.id });
    expect(provider.previewCalls).toBe(1);
  });

  it('revalidates term-change capability before claiming execution', async () => {
    const provider = new MigrationPreviewProvider();
    provider.supportsCurrencyChange = true;
    const { payable, product, storage, subscription } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const target = await payable.prices(TENANT).create({
      productId: product.id,
      unitAmount: Money.of(2_000, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    await storage.priceProviderBindings.create({
      tenantId: TENANT,
      priceId: target.id,
      provider: 'stripe',
      providerPriceId: 'price_eur_remote',
    });
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'currency-capability-preview',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.supportsCurrencyChange = false;

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'currency-capability-removed' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED' });
    await expect(resource.retrieve(preview.id)).resolves.toMatchObject({
      status: 'previewed',
      attemptCount: 0,
    });
    expect(provider.applyCalls).toBe(0);
  });

  it('projects the migrated item by stable identity when another item uses the target price', async () => {
    const { database, payable, storage, subscription, target } =
      await setupMigrationPreview(databases);
    const [sourceItem] = await storage.subscriptionItems.listBySubscription(
      subscription.id,
      TENANT,
    );
    if (!sourceItem) throw new Error('Expected source subscription item');
    const existingTarget = await storage.subscriptionItems.create({
      subscriptionId: subscription.id,
      priceId: target.id,
      providerItemId: 'si_existing_target',
      quantity: 9,
    });
    await database('payable_subscription_items')
      .where({ id: existingTarget.id })
      .update({ id: 'a_existing_target' });
    await database('payable_subscription_items')
      .where({ id: sourceItem.id })
      .update({ id: 'z_migrated_source' });
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'stable-item-projection',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
      itemId: 'z_migrated_source',
      quantity: 3,
    });

    await resource.approve(preview.id, { idempotencyKey: 'stable-item-projection-apply' });

    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      canonicalPriceId: target.id,
      acceptedQuantity: 3,
    });
    await expect(
      storage.subscriptionItems.listBySubscription(subscription.id, TENANT),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a_existing_target', priceId: target.id, quantity: 9 }),
        expect.objectContaining({ id: 'z_migrated_source', priceId: target.id, quantity: 3 }),
      ]),
    );
  });
});
