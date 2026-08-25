import { afterEach, describe, expect, it, vi } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { hashRequest } from '../src/support/hash/request-hash';
import {
  type MigrationPreviewDatabase,
  migrationPreviewInput,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

describe('canonical subscription price migration concurrency and ambiguity', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('normalizes a concurrent preview uniqueness race without retaining storage cause', async () => {
    const { payable, provider, subscription, target } = await setupMigrationPreview(databases);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const originalPreview = provider.previewSubscriptionChange.bind(provider);
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    provider.previewSubscriptionChange = async (input, context) => {
      arrivals += 1;
      if (arrivals === 2) release();
      await barrier;
      return originalPreview(input, context);
    };
    const result = await Promise.allSettled(
      ['preview-race-a', 'preview-race-b'].map((idempotencyKey) =>
        resource.preview({
          ...migrationPreviewInput,
          idempotencyKey,
          subscriptionId: subscription.id,
          targetPriceId: target.id,
        }),
      ),
    );
    expect(result.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = result.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' },
    });
    if (rejected?.status !== 'rejected') throw new Error('Expected one rejected preview');
    expect((rejected.reason as Error).cause).toBeUndefined();
  });

  it('uses a tenant/status/token claim so concurrent owners call the provider once', async () => {
    const { payable, provider, storage, subscription, target } =
      await setupMigrationPreview(databases);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    let releaseProvider!: () => void;
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    provider.beforeApply = async () => {
      providerStarted();
      await barrier;
    };

    const owner = resource.approve(preview.id, { idempotencyKey: 'owner-a' });
    await started;
    const executing = await resource.retrieve(preview.id);
    expect(executing).toMatchObject({ status: 'executing', executionToken: expect.any(String) });
    await expect(
      storage.subscriptionPriceMigrations.compareAndSwapState({
        id: preview.id,
        tenantId: TENANT,
        expectedStatus: 'executing',
        expectedExecutionToken: 'not-the-owner',
        nextStatus: 'applied',
        executionToken: 'not-the-owner',
        attemptCount: executing.attemptCount,
        failureCode: null,
        failureMessage: null,
        executionStartedAt: executing.executionStartedAt,
        appliedAt: new Date(),
        failedAt: null,
        reconciliationRequiredAt: null,
        cancelledAt: null,
        updatedAt: new Date(),
      }),
    ).resolves.toBeNull();
    await expect(resource.approve(preview.id, { idempotencyKey: 'owner-b' })).rejects.toMatchObject(
      { code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' },
    );
    await expect(
      resource.cancel(preview.id, { idempotencyKey: 'cancel-executing' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' });
    expect(provider.applyCalls).toBe(1);
    releaseProvider();
    await expect(owner).resolves.toMatchObject({
      status: 'applied',
      executionToken: executing.executionToken,
    });
  });

  it('derives the provider operation key from the persisted canonical binding key', async () => {
    const { payable, provider, providerBinding, subscription, target } =
      await setupMigrationPreview(databases, 'regional-route');
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });

    await resource.approve(preview.id, { idempotencyKey: 'approve-regional-route' });

    const digest = await hashRequest([TENANT, 'regional-route', providerBinding.id, preview.id, 1]);
    expect(provider.lastApplyContext?.idempotencyKey).toBe(
      `payable:subscription-price-migration-execute:v1:${digest}`,
    );
  });

  it.each([
    'changed source snapshot',
    'archived target',
  ] as const)('leaves a %s preparation failure unclaimed and provider-neutral', async (staleState) => {
    const { database, payable, provider, subscription, target } =
      await setupMigrationPreview(databases);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    if (staleState === 'changed source snapshot') {
      await database('payable_subscriptions')
        .where({ id: subscription.id })
        .update({ accepted_unit_amount: 999 });
    } else {
      await payable.prices(TENANT).archive(target.id);
    }

    await expect(
      resource.approve(preview.id, { idempotencyKey: `prepare-fails-${staleState}` }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_PREVIEW_STALE' });
    await expect(resource.retrieve(preview.id)).resolves.toMatchObject({
      status: 'previewed',
      executionToken: null,
      attemptCount: 0,
    });
    expect(provider.applyCalls).toBe(0);
  });

  it('applies a secondary item without replacing the primary accepted-price snapshot', async () => {
    const { payable, storage, product, source, target, subscription } =
      await setupMigrationPreview(databases);
    const secondarySource = await payable.prices(TENANT).create({
      productId: product.id,
      unitAmount: Money.of(1_500, 'USD'),
      type: 'recurring',
      interval: 'month',
    });
    await storage.priceProviderBindings.create({
      tenantId: TENANT,
      priceId: secondarySource.id,
      provider: 'stripe',
      providerPriceId: 'price_secondary_remote',
    });
    const secondaryItem = await storage.subscriptionItems.create({
      subscriptionId: subscription.id,
      priceId: secondarySource.id,
      providerItemId: 'si_secondary_remote',
      quantity: 2,
    });
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'preview-secondary-item',
      subscriptionId: subscription.id,
      itemId: secondaryItem.id,
      targetPriceId: target.id,
    });

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'approve-secondary-item' }),
    ).resolves.toMatchObject({ status: 'applied' });
    const items = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(items.map(({ priceId }) => priceId).toSorted()).toEqual(
      [source.id, target.id].toSorted(),
    );
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      priceId: source.id,
      canonicalPriceId: source.id,
      acceptedUnitAmount: source.unitAmount,
    });
  });

  it('moves a post-provider projection failure to reconciliation and never blindly retries', async () => {
    const { payable, provider, storage, subscription, source, target } =
      await setupMigrationPreview(databases);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    const transaction = storage.transaction.bind(storage);
    let calls = 0;
    vi.spyOn(storage, 'transaction').mockImplementation(async (work) => {
      calls += 1;
      if (calls === 2) throw new Error('projection unavailable after provider success');
      return transaction(work);
    });

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'projection-fails' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    const uncertain = await resource.retrieve(preview.id);
    expect(uncertain).toMatchObject({
      status: 'reconciliation_required',
      executionToken: expect.any(String),
      failureCode: 'SUBSCRIPTION_MIGRATION_PROJECTION_FAILED',
    });
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.priceId).toBe(source.id);
    await expect(
      resource.retry(preview.id, { idempotencyKey: 'no-blind-projection-retry' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    expect(provider.applyCalls).toBe(1);
  });

  it('treats provider timeouts as ambiguous and never automatically calls the provider again', async () => {
    const { payable, provider, subscription, target } = await setupMigrationPreview(databases);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.applyError = Object.assign(new Error('provider timed out'), { name: 'TimeoutError' });

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'provider-timeout' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    await expect(resource.retrieve(preview.id)).resolves.toMatchObject({
      status: 'reconciliation_required',
      executionToken: expect.any(String),
      failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_OUTCOME_UNKNOWN',
    });
    provider.applyError = undefined;
    await expect(
      resource.retry(preview.id, { idempotencyKey: 'no-blind-timeout-retry' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    await expect(
      resource.approve(preview.id, { idempotencyKey: 'no-reapprove-timeout' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    expect(provider.applyCalls).toBe(1);
  });
});
