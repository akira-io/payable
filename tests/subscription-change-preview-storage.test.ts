import { afterEach, describe, expect, it } from 'vitest';
import { SubscriptionChangePreviewStore } from '../src/application/services/subscriptions/subscription-change-preview-store';
import type { SubscriptionChangePreview } from '../src/domain/dtos/subscription-change.dto';
import { FakeClock } from '../src/support/clock/fake-clock';
import { InMemoryIdempotencyStore } from './support/fakes';
import {
  MIGRATION_NOW,
  MIGRATION_TENANT,
  type MigrationPreviewDatabase,
  MigrationPreviewProvider,
  setupMigrationPreview,
} from './support/subscription-price-migration-preview';

const NOW = new Date('2026-08-07T10:00:00.000Z');

function preview(token = 'scp_opaque'): SubscriptionChangePreview {
  return {
    previewToken: token,
    provider: 'stripe',
    subscriptionId: 'subscription_local',
    currentItems: [
      { itemId: 'item_local', providerItemId: 'si_provider', priceId: 'price_old', quantity: 1 },
    ],
    proposedItems: [
      { itemId: 'item_local', providerItemId: 'si_provider', priceId: 'price_new', quantity: 2 },
    ],
    effectiveTiming: 'immediate',
    prorationPolicy: 'prorateImmediately',
    paymentFailurePolicy: 'preventChange',
    calculatedAt: NOW,
    expiresAt: new Date('2026-08-07T10:15:00.000Z'),
    currentRenewalDate: new Date('2026-09-07T10:00:00.000Z'),
    immediateAdjustment: { direction: 'charge', amount: 500, currency: 'USD' },
    nextRenewal: { amount: 2_000, date: new Date('2026-09-07T10:00:00.000Z'), currency: 'USD' },
    warnings: [],
    providerLimitations: [],
  };
}

describe('SubscriptionChangePreviewStore', () => {
  it('isolates preview records by namespace and tenant', async () => {
    const records = new InMemoryIdempotencyStore();
    const store = new SubscriptionChangePreviewStore(records, new FakeClock(NOW));
    const saved = preview();

    await store.save(saved, 'tenant_a');

    expect(await store.load(saved.previewToken, 'tenant_a')).toEqual(saved);
    await expect(store.load(saved.previewToken, 'tenant_b')).rejects.toMatchObject({
      code: 'SUBSCRIPTION_CHANGE_PREVIEW_NOT_FOUND',
    });
    expect(await records.find(saved.previewToken, 'tenant_a')).toBeNull();
  });

  it('rejects an expired preview', async () => {
    const clock = new FakeClock(NOW);
    const store = new SubscriptionChangePreviewStore(new InMemoryIdempotencyStore(), clock);
    const saved = preview();
    await store.save(saved, 'tenant_a');
    clock.advance(15 * 60 * 1_000);

    await expect(store.load(saved.previewToken, 'tenant_a')).rejects.toMatchObject({
      code: 'SUBSCRIPTION_CHANGE_PREVIEW_EXPIRED',
    });
  });

  it('detects a changed stored preview contract', async () => {
    const records = new InMemoryIdempotencyStore();
    const store = new SubscriptionChangePreviewStore(records, new FakeClock(NOW));
    const saved = preview();
    await store.save(saved, 'tenant_a');
    const key = `subscription-change-preview:${saved.previewToken}`;
    const record = await records.find(key, 'tenant_a');
    await records.put(
      {
        ...(record as NonNullable<typeof record>),
        response: { ...saved, proposedItems: [{ ...saved.proposedItems[0], quantity: 9 }] },
      },
      'tenant_a',
    );

    await expect(store.load(saved.previewToken, 'tenant_a')).rejects.toMatchObject({
      code: 'SUBSCRIPTION_CHANGE_PREVIEW_IMMUTABLE',
    });
  });
});

describe('canonical subscription change compatibility', () => {
  const databases: MigrationPreviewDatabase[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('projects one canonical migration as the exact legacy preview DTO and replays it', async () => {
    const provider = new MigrationPreviewProvider();
    const { payable, storage, subscription } = await setupMigrationPreview(
      databases,
      'stripe-eu',
      provider,
    );
    const renewalDate = new Date('2026-09-25T00:00:00.000Z');
    provider.nextRenewalDate = new Date('2026-10-25T00:00:00.000Z');
    provider.warnings = ['Tax estimate may change'];
    provider.providerLimitations = ['Provider schedules invoice adjustments separately'];
    await storage.subscriptions.update(
      subscription.id,
      { currentPeriodEnd: renewalDate },
      MIGRATION_TENANT,
    );
    const [item] = await storage.subscriptionItems.listBySubscription(
      subscription.id,
      MIGRATION_TENANT,
    );
    if (!item) throw new Error('Expected canonical subscription item');
    const resource = payable.subscription(subscription.id, MIGRATION_TENANT);
    const input = {
      priceId: 'price_target_remote',
      effectiveTiming: 'immediate' as const,
      prorationPolicy: 'prorateImmediately' as const,
      paymentFailurePolicy: 'preventChange' as const,
      idempotencyKey: 'legacy-canonical-preview',
    };

    const preview = await resource.previewChange(input);
    const replayed = await resource.previewChange(input);

    expect(preview).toEqual({
      previewToken: expect.stringMatching(/^scp_/),
      provider: 'stripe-eu',
      subscriptionId: subscription.id,
      currentItems: [
        {
          itemId: item.id,
          providerItemId: 'si_remote',
          priceId: 'price_source_remote',
          quantity: 1,
        },
      ],
      proposedItems: [
        {
          itemId: item.id,
          providerItemId: 'si_remote',
          priceId: 'price_target_remote',
          quantity: 1,
        },
      ],
      effectiveTiming: 'immediate',
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      calculatedAt: MIGRATION_NOW,
      expiresAt: new Date('2026-08-25T10:15:00.000Z'),
      currentRenewalDate: renewalDate,
      immediateAdjustment: { direction: 'charge', amount: 500, currency: 'USD' },
      nextRenewal: { amount: 2_000, currency: 'USD', date: provider.nextRenewalDate },
      warnings: provider.warnings,
      providerLimitations: provider.providerLimitations,
    });
    expect(replayed).toEqual(preview);
    expect(provider.previewCalls).toBe(1);
    const migrations = await payable
      .subscriptionPriceMigrations(MIGRATION_TENANT)
      .list({ subscriptionId: subscription.id });
    expect(migrations.items).toHaveLength(1);
    const logs = await payable.auditLogs(MIGRATION_TENANT).run({
      resourceId: subscription.id,
    });
    expect(logs.filter(({ action }) => action === 'subscription.change_previewed')).toHaveLength(1);
  });

  it('applies and replays an immediate canonical migration through the legacy API', async () => {
    const { payable, provider, subscription, target } = await setupMigrationPreview(databases);
    const resource = payable.subscription(subscription.id, MIGRATION_TENANT);
    const preview = await resource.previewChange({
      priceId: 'price_target_remote',
      effectiveTiming: 'immediate',
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'legacy-immediate-preview',
    });

    const applied = await resource.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'legacy-immediate-apply',
    });
    const replayed = await resource.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'legacy-immediate-replay',
    });

    expect(applied.canonicalPriceId).toBe(target.id);
    expect(replayed.canonicalPriceId).toBe(target.id);
    expect(provider.applyCalls).toBe(1);
    const [migration] = (
      await payable
        .subscriptionPriceMigrations(MIGRATION_TENANT)
        .list({ subscriptionId: subscription.id })
    ).items;
    expect(migration?.status).toBe('applied');
    const logs = await payable.auditLogs(MIGRATION_TENANT).run({
      resourceId: subscription.id,
    });
    expect(logs.filter(({ action }) => action === 'subscription.change_applied')).toHaveLength(1);
  });

  it('keeps the canonical price unchanged for a next-renewal legacy apply', async () => {
    const { payable, provider, subscription, source } = await setupMigrationPreview(databases);
    const resource = payable.subscription(subscription.id, MIGRATION_TENANT);
    const preview = await resource.previewChange({
      priceId: 'price_target_remote',
      effectiveTiming: 'nextRenewal',
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'legacy-renewal-preview',
    });
    const applied = await resource.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'legacy-renewal-apply',
    });
    const replayed = await resource.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'legacy-renewal-replay',
    });

    expect([applied.canonicalPriceId, replayed.canonicalPriceId]).toEqual([source.id, source.id]);
    const migrations = payable.subscriptionPriceMigrations(MIGRATION_TENANT);
    const [migration] = (await migrations.list({ subscriptionId: subscription.id })).items;
    expect(migration).toMatchObject({ status: 'pending_renewal', appliedAt: null });
    if (!migration) throw new Error('Expected canonical subscription migration');
    await expect(
      migrations.settle(migration.id, { idempotencyKey: 'legacy-renewal-settle-too-soon' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' });
    expect(provider.applyCalls).toBe(1);
  });

  it('schedules a dated legacy apply without calling the provider early', async () => {
    const { payable, provider, subscription, source } = await setupMigrationPreview(databases);
    const resource = payable.subscription(subscription.id, MIGRATION_TENANT);
    const preview = await resource.previewChange({
      priceId: 'price_target_remote',
      effectiveTiming: 'scheduled',
      effectiveAt: new Date('2026-08-26T10:00:00.000Z'),
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'legacy-scheduled-preview',
    });

    const scheduled = await resource.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'legacy-scheduled-apply',
    });

    expect(scheduled.canonicalPriceId).toBe(source.id);
    expect(provider.applyCalls).toBe(0);
    const migrations = payable.subscriptionPriceMigrations(MIGRATION_TENANT);
    const [migration] = (await migrations.list({ subscriptionId: subscription.id })).items;
    expect(migration?.status).toBe('scheduled');
  });

  it('returns a cause-free canonical error while retaining the migration fence', async () => {
    const provider = new MigrationPreviewProvider();
    const { payable, subscription } = await setupMigrationPreview(databases, 'stripe', provider);
    const resource = payable.subscription(subscription.id, MIGRATION_TENANT);
    const preview = await resource.previewChange({
      priceId: 'price_target_remote',
      effectiveTiming: 'immediate',
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'legacy-provider-failure-preview',
    });
    provider.applyError = new Error('provider rejected');
    const error = await resource
      .applyChange({
        previewToken: preview.previewToken,
        idempotencyKey: 'legacy-provider-failure-apply',
      })
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED',
      message: 'Subscription migration requires reconciliation',
      context: { migrationId: expect.any(String) },
    });
    expect((error as Error).cause).toBeUndefined();
    expect((error as Error).message).not.toContain('provider rejected');
    const migrations = payable.subscriptionPriceMigrations(MIGRATION_TENANT);
    const [migration] = (await migrations.list({ subscriptionId: subscription.id })).items;
    expect(migration).toMatchObject({ status: 'reconciliation_required' });
    if (!migration) throw new Error('Expected canonical subscription migration');
    await expect(
      resource.applyChange({
        previewToken: preview.previewToken,
        idempotencyKey: 'legacy-provider-failure-retry',
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_RECONCILIATION_REQUIRED',
      context: { key: 'legacy-provider-failure-retry' },
    });
    expect(provider.applyCalls).toBe(1);
  });
});
