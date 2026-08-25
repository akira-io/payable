import { afterEach, describe, expect, it } from 'vitest';
import {
  type MigrationPreviewDatabase,
  migrationPreviewInput,
  MIGRATION_NOW as NOW,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

describe('canonical subscription price migration execution', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('applies an immediate migration once and atomically records its canonical transition', async () => {
    const { database, payable, provider, storage, subscription, source, target } =
      await setupMigrationPreview(databases);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });

    const applied = await resource.approve(preview.id, { idempotencyKey: 'approve-immediate' });
    const replay = await resource.approve(preview.id, { idempotencyKey: 'approve-immediate' });

    expect(applied).toMatchObject({ status: 'applied', attemptCount: 1 });
    expect(replay).toEqual(applied);
    expect(provider.applyCalls).toBe(1);
    expect(provider.lastApply).toMatchObject({
      providerSubscriptionId: 'sub_remote',
      currentItems: [{ priceId: 'price_source_remote' }],
      proposedItems: [{ priceId: 'price_target_remote' }],
      effectiveTiming: 'immediate',
    });
    expect(provider.lastApplyContext?.idempotencyKey).toMatch(
      /^payable:subscription-price-migration-execute:v1:/u,
    );
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.priceId).toBe(target.id);
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      priceId: target.id,
      canonicalPriceId: target.id,
      acceptedUnitAmount: target.unitAmount,
      acceptedCurrency: target.currency,
    });
    expect(source.id).not.toBe(target.id);
    const audit = await storage.auditLogs.list({
      tenantId: TENANT,
      resourceType: 'subscription_price_migration',
      resourceId: preview.id,
    });
    expect(audit.map(({ action }) => action)).toEqual([
      'subscription.price_migration.applied',
      'subscription.price_migration.executing',
    ]);
    await expect(
      database('payable_outbox_events')
        .where({ tenant_id: TENANT })
        .whereLike('event_type', 'subscription.price_migration.%')
        .orderBy('created_at')
        .pluck('event_type'),
    ).resolves.toEqual([
      'subscription.price_migration.executing.v1',
      'subscription.price_migration.applied.v1',
    ]);
  });

  it('schedules explicit dates, exposes bounded stable due pages, and executes only when due', async () => {
    const { payable, provider, storage, clock, subscription, source, target } =
      await setupMigrationPreview(databases);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const effectiveAt = new Date('2026-08-26T10:00:00.000Z');
    const preview = await resource.preview({
      ...migrationPreviewInput,
      timing: { effectiveTiming: 'scheduled', effectiveAt },
      idempotencyKey: 'preview-scheduled',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });

    const scheduled = await resource.approve(preview.id, {
      idempotencyKey: 'approve-scheduled',
    });

    expect(scheduled).toMatchObject({ status: 'scheduled', scheduledAt: NOW });
    expect(provider.applyCalls).toBe(0);
    await expect(resource.due({ dueBefore: new Date(effectiveAt.getTime() - 1) })).resolves.toEqual(
      {
        items: [],
        hasMore: false,
        nextCursor: null,
      },
    );
    await expect(resource.due({ dueBefore: effectiveAt, limit: 1 })).resolves.toMatchObject({
      items: [{ id: preview.id }],
      hasMore: false,
      nextCursor: null,
    });
    await expect(resource.due({ dueBefore: effectiveAt, limit: 0 })).rejects.toMatchObject({
      code: 'COLLECTION_LIMIT_INVALID',
    });
    await expect(
      resource.execute(preview.id, { idempotencyKey: 'execute-too-soon' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' });
    clock.set(effectiveAt);
    await expect(
      resource.execute(preview.id, { idempotencyKey: 'execute-due' }),
    ).resolves.toMatchObject({ status: 'applied', attemptCount: 1 });
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.priceId).toBe(target.id);
    expect(item?.priceId).not.toBe(source.id);
  });

  it('pages equal-time due migrations by a stable effective-date and id boundary', async () => {
    const { payable, storage, source, target, subscription } =
      await setupMigrationPreview(databases);
    const secondCustomer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'second-migration-user',
      email: 'second-migration@example.com',
    });
    const secondSubscription = await payable.canonicalSubscriptions(TENANT).create({
      customerId: secondCustomer.id,
      name: 'default',
      priceId: source.id,
      activation: { state: 'active', startsAt: NOW },
      collectionResponsibility: 'merchant',
      source: 'test',
    });
    await payable.canonicalSubscriptions(TENANT).attachProvider(secondSubscription.id, {
      provider: 'stripe',
      providerSubscriptionId: 'sub_remote_second',
    });
    const [secondItem] = await storage.subscriptionItems.listBySubscription(
      secondSubscription.id,
      TENANT,
    );
    if (!secondItem) throw new Error('Expected second canonical subscription item');
    await storage.subscriptionItems.updateById(
      secondSubscription.id,
      secondItem.id,
      { providerItemId: 'si_remote_second' },
      TENANT,
    );
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const effectiveAt = new Date('2026-08-26T10:00:00.000Z');
    const previews = await Promise.all(
      [subscription.id, secondSubscription.id].map((subscriptionId, index) =>
        resource.preview({
          ...migrationPreviewInput,
          timing: { effectiveTiming: 'scheduled', effectiveAt },
          idempotencyKey: `preview-page-${index}`,
          subscriptionId,
          targetPriceId: target.id,
        }),
      ),
    );
    await Promise.all(
      previews.map((preview, index) =>
        resource.approve(preview.id, { idempotencyKey: `approve-page-${index}` }),
      ),
    );
    const first = await resource.due({ dueBefore: effectiveAt, limit: 1 });
    const second = await resource.due({
      dueBefore: effectiveAt,
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect(first).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });
    expect([...first.items, ...second.items].map(({ id }) => id)).toEqual(
      previews.map(({ id }) => id).toSorted(),
    );
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('cancels only a pre-execution migration and never calls the provider', async () => {
    const { payable, provider, subscription, target } = await setupMigrationPreview(databases);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      timing: {
        effectiveTiming: 'scheduled',
        effectiveAt: new Date('2026-08-26T10:00:00.000Z'),
      },
      idempotencyKey: 'preview-cancel',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    await resource.approve(preview.id, { idempotencyKey: 'approve-before-cancel' });
    const cancelled = await resource.cancel(preview.id, { idempotencyKey: 'cancel-scheduled' });
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelledAt: NOW });
    expect(provider.applyCalls).toBe(0);
    await expect(
      resource.execute(preview.id, { idempotencyKey: 'execute-cancelled' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' });
  });

  it('rejects expired and stale previews without acquiring a provider execution claim', async () => {
    const expired = await setupMigrationPreview(databases);
    const expiredResource = expired.payable.subscriptionPriceMigrations(TENANT);
    const expiredPreview = await expiredResource.preview({
      ...migrationPreviewInput,
      subscriptionId: expired.subscription.id,
      targetPriceId: expired.target.id,
    });
    expired.clock.advance(15 * 60 * 1_000 + 1);

    await expect(
      expiredResource.approve(expiredPreview.id, { idempotencyKey: 'approve-expired' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_PREVIEW_STALE' });
    await expect(expiredResource.retrieve(expiredPreview.id)).resolves.toMatchObject({
      status: 'previewed',
      executionToken: null,
    });
    expect(expired.provider.applyCalls).toBe(0);

    const stale = await setupMigrationPreview(databases);
    const staleResource = stale.payable.subscriptionPriceMigrations(TENANT);
    const stalePreview = await staleResource.preview({
      ...migrationPreviewInput,
      subscriptionId: stale.subscription.id,
      targetPriceId: stale.target.id,
    });
    const [item] = await stale.storage.subscriptionItems.listBySubscription(
      stale.subscription.id,
      TENANT,
    );
    if (!item) throw new Error('Expected canonical subscription item');
    await stale.storage.subscriptionItems.updateById(
      stale.subscription.id,
      item.id,
      { quantity: 2 },
      TENANT,
    );

    await expect(
      staleResource.approve(stalePreview.id, { idempotencyKey: 'approve-stale' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_PREVIEW_STALE' });
    await expect(staleResource.retrieve(stalePreview.id)).resolves.toMatchObject({
      status: 'previewed',
      executionToken: null,
    });
    expect(stale.provider.applyCalls).toBe(0);
  });
});
