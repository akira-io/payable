import { afterEach, describe, expect, it } from 'vitest';
import { IdempotencyService } from '../src/application/services/idempotency/idempotency-service';
import { SubscriptionChangePreviewStore } from '../src/application/services/subscriptions/subscription-change-preview-store';
import type { SubscriptionChangePreview } from '../src/domain/dtos/subscription-change.dto';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import {
  MIGRATION_NOW,
  MIGRATION_TENANT,
  type MigrationPreviewDatabase,
  MigrationPreviewProvider,
  setupMigrationPreview,
} from './support/subscription-price-migration-preview';

describe('subscription change canonical compatibility review', () => {
  const databases: MigrationPreviewDatabase[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('executes with the immutable approved current renewal date', async () => {
    const provider = new MigrationPreviewProvider();
    provider.nextRenewalDate = new Date('2026-10-25T00:00:00.000Z');
    const { payable, storage, subscription } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const approvedRenewalDate = new Date('2026-09-25T00:00:00.000Z');
    await storage.subscriptions.update(
      subscription.id,
      { currentPeriodEnd: approvedRenewalDate },
      MIGRATION_TENANT,
    );
    const resource = payable.subscription(subscription.id, MIGRATION_TENANT);
    const preview = await resource.previewChange(changeInput('approved-renewal'));

    await resource.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'approved-renewal-apply',
    });

    expect(provider.lastApply?.renewalDate).toEqual(approvedRenewalDate);
    expect(provider.lastApply?.renewalDate).not.toEqual(provider.nextRenewalDate);
  });

  it('replays an intrinsic-provider alias record created before migration 021', async () => {
    const provider = new MigrationPreviewProvider();
    const { database, payable, storage, clock, subscription } = await setupMigrationPreview(
      databases,
      'stripe-eu',
      provider,
    );
    const input = changeInput('pre021-alias');
    const [item] = await storage.subscriptionItems.listBySubscription(
      subscription.id,
      MIGRATION_TENANT,
    );
    if (!item) throw new Error('Expected canonical subscription item');
    const stored = legacyPreview(subscription.id, item.id, 'scp_pre021_alias');
    const records = new KnexIdempotencyRepository(database, clock);
    await new SubscriptionChangePreviewStore(records, clock).save(stored, MIGRATION_TENANT);
    await new IdempotencyService(records, clock).execute({
      key: input.idempotencyKey,
      storageKey: `subscription-change-preview-request:${MIGRATION_TENANT}:${provider.name}:${subscription.id}:${input.idempotencyKey}`,
      scope: 'subscription-change-preview-request',
      operation: 'preview',
      request: { subscriptionId: subscription.id, ...input },
      resourceType: 'subscription',
      resourceId: subscription.id,
      tenantId: MIGRATION_TENANT,
      run: async () => stored,
    });

    const replayed = await payable
      .subscription(subscription.id, MIGRATION_TENANT)
      .previewChange(input);

    expect(replayed).toEqual(stored);
    expect(provider.previewCalls).toBe(0);
    const migrations = await payable
      .subscriptionPriceMigrations(MIGRATION_TENANT)
      .list({ subscriptionId: subscription.id });
    expect(migrations.items).toHaveLength(0);
  });

  it('replays and applies immutable provider identifiers after local mapping drift', async () => {
    const provider = new MigrationPreviewProvider();
    const { payable, storage, subscription, source, target } = await setupMigrationPreview(
      databases,
      'stripe-eu',
      provider,
    );
    const resource = payable.subscription(subscription.id, MIGRATION_TENANT);
    const input = changeInput('immutable-provider-evidence');
    const preview = await resource.previewChange(input);
    const approvedProviderInput = provider.lastPreview;
    const [item] = await storage.subscriptionItems.listBySubscription(
      subscription.id,
      MIGRATION_TENANT,
    );
    if (!item || !storage.priceProviderBindings?.updateProviderId) {
      throw new Error('Expected mutable test bindings');
    }
    await storage.subscriptionItems.updateById(
      subscription.id,
      item.id,
      { providerItemId: 'si_drifted' },
      MIGRATION_TENANT,
    );
    for (const [priceId, providerPriceId] of [
      [source.id, 'price_source_drifted'],
      [target.id, 'price_target_drifted'],
    ] as const) {
      const binding = await storage.priceProviderBindings.findByPriceAndProvider(
        priceId,
        'stripe-eu',
        MIGRATION_TENANT,
      );
      if (!binding) throw new Error('Expected price binding');
      await storage.priceProviderBindings.updateProviderId(binding.id, providerPriceId);
    }

    expect(await resource.previewChange(input)).toEqual(preview);
    await resource.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'immutable-provider-evidence-apply',
    });

    expect(provider.lastApply).toEqual(approvedProviderInput);
    expect(provider.applyCalls).toBe(1);
  });

  it('keeps canonical migration resources provider-neutral', async () => {
    const { payable, subscription, source, target } = await setupMigrationPreview(databases);
    const preview = await payable
      .subscription(subscription.id, MIGRATION_TENANT)
      .previewChange(changeInput('provider-neutral-public-migration'));
    const migrationId = preview.previewToken.slice('scp_'.length);
    const resource = payable.subscriptionPriceMigrations(MIGRATION_TENANT);

    const migration = await resource.retrieve(migrationId);
    const listed = await resource.list({ subscriptionId: subscription.id });

    expect(migration).not.toHaveProperty('providerEvidence');
    expect(migration).not.toHaveProperty('provider');
    expect(migration).not.toHaveProperty('providerSubscriptionId');
    expect(migration.currentItems).toEqual([expect.objectContaining({ priceId: source.id })]);
    expect(migration.proposedItems).toEqual([expect.objectContaining({ priceId: target.id })]);
    expect(migration.currentItems[0]).not.toHaveProperty('providerItemId');
    expect(migration.proposedItems[0]).not.toHaveProperty('providerItemId');
    expect(listed.items).toEqual([migration]);
  });

  it.each([
    ['ambiguous', undefined, 'SUBSCRIPTION_ITEM_AMBIGUOUS'],
    ['missing', 'missing-item', 'SUBSCRIPTION_ITEM_NOT_FOUND'],
  ] as const)('preserves the legacy %s item-selection error', async (_case, itemId, code) => {
    const { payable, storage, subscription, source } = await setupMigrationPreview(databases);
    if (itemId === undefined) {
      await storage.subscriptionItems.create({
        subscriptionId: subscription.id,
        priceId: source.id,
        providerItemId: 'si_second',
        quantity: 1,
      });
    }

    await expect(
      payable.subscription(subscription.id, MIGRATION_TENANT).previewChange({
        ...changeInput(`legacy-item-${_case}`),
        ...(itemId ? { itemId } : {}),
      }),
    ).rejects.toMatchObject({ code });
  });

  it('rejects an unmapped provider price that happens to equal a canonical id', async () => {
    const { payable, provider, subscription, target } = await setupMigrationPreview(databases);

    await expect(
      payable.subscription(subscription.id, MIGRATION_TENANT).previewChange({
        ...changeInput('canonical-id-collision'),
        priceId: target.id,
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_TARGET_INELIGIBLE' });
    expect(provider.previewCalls).toBe(0);
  });
});

function changeInput(idempotencyKey: string) {
  return {
    priceId: 'price_target_remote',
    effectiveTiming: 'immediate' as const,
    prorationPolicy: 'prorateImmediately' as const,
    paymentFailurePolicy: 'preventChange' as const,
    idempotencyKey,
  };
}

function legacyPreview(
  subscriptionId: string,
  itemId: string,
  previewToken: string,
): SubscriptionChangePreview {
  return {
    previewToken,
    provider: 'stripe',
    subscriptionId,
    currentItems: [{ itemId, providerItemId: 'si_remote', priceId: 'source_old', quantity: 1 }],
    proposedItems: [{ itemId, providerItemId: 'si_remote', priceId: 'target_old', quantity: 1 }],
    effectiveTiming: 'immediate',
    prorationPolicy: 'prorateImmediately',
    paymentFailurePolicy: 'preventChange',
    calculatedAt: MIGRATION_NOW,
    expiresAt: new Date('2026-08-25T10:15:00.000Z'),
    currentRenewalDate: new Date('2026-09-25T00:00:00.000Z'),
    immediateAdjustment: { direction: 'charge', amount: 500, currency: 'USD' },
    nextRenewal: {
      amount: 2_000,
      currency: 'USD',
      date: new Date('2026-09-25T00:00:00.000Z'),
    },
    warnings: ['legacy warning'],
    providerLimitations: ['legacy limitation'],
  };
}
