import { afterEach, describe, expect, it } from 'vitest';
import {
  MigrationOutcomePreviewProvider,
  type MigrationPreviewDatabase,
  migrationPreviewInput,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

describe('pending-renewal subscription price migration settlement', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('rejects next-renewal preview without a valid renewal boundary before provider work', async () => {
    const { database, payable, provider, storage, subscription, target } =
      await setupMigrationPreview(databases);
    await storage.subscriptions.update(subscription.id, { currentPeriodEnd: null }, TENANT);
    await expect(
      payable.subscriptionPriceMigrations(TENANT).preview({
        ...migrationPreviewInput,
        timing: { effectiveTiming: 'nextRenewal' },
        idempotencyKey: 'missing-renewal-boundary',
        subscriptionId: subscription.id,
        targetPriceId: target.id,
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RENEWAL_DATE_REQUIRED' });
    expect(provider.previewCalls).toBe(0);
    await expect(database('payable_subscription_mutation_claims')).resolves.toHaveLength(0);
  });

  it('settles provider-confirmed renewal only at its immutable boundary', async () => {
    const { database, payable, provider, storage, clock, subscription, source, target } =
      await setupMigrationPreview(databases);
    const renewalDate = new Date('2026-09-25T00:00:00.000Z');
    await storage.subscriptions.update(subscription.id, { currentPeriodEnd: renewalDate }, TENANT);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      timing: { effectiveTiming: 'nextRenewal' },
      idempotencyKey: 'preview-renewal',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'approve-renewal' }),
    ).resolves.toMatchObject({ status: 'pending_renewal', appliedAt: null });
    expect(provider.lastApply?.effectiveTiming).toBe('nextRenewal');
    const providerCalls = provider.applyCalls;
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.priceId).toBe(source.id);
    await expect(
      resource.cancel(preview.id, { idempotencyKey: 'cancel-pending-renewal' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' });
    await expect(
      resource.settle(preview.id, { idempotencyKey: 'settle-renewal-too-soon' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' });
    clock.set(renewalDate);
    await storage.subscriptions.update(
      subscription.id,
      { currentPeriodEnd: new Date('2026-10-25T00:00:00.000Z') },
      TENANT,
    );
    await expect(
      resource.settle(preview.id, { idempotencyKey: 'settle-renewal' }),
    ).resolves.toMatchObject({ status: 'applied', appliedAt: renewalDate });
    expect(provider.applyCalls).toBe(providerCalls);
    const [settledItem] = await storage.subscriptionItems.listBySubscription(
      subscription.id,
      TENANT,
    );
    expect(settledItem?.priceId).toBe(target.id);
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      priceId: target.id,
      canonicalPriceId: target.id,
      acceptedUnitAmount: target.unitAmount,
    });
    await expect(
      database('payable_subscription_mutation_claims').where({ subscription_id: subscription.id }),
    ).resolves.toHaveLength(0);
  });

  it('keeps reconciled renewal fenced until explicit settlement', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { database, payable, storage, clock, subscription, source, target } =
      await setupMigrationPreview(databases, 'stripe', provider);
    const renewalDate = new Date('2026-09-25T00:00:00.000Z');
    await storage.subscriptions.update(subscription.id, { currentPeriodEnd: renewalDate }, TENANT);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      timing: { effectiveTiming: 'nextRenewal' },
      idempotencyKey: 'preview-next-renewal-reconciliation',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.outcomeError = new Error('ambiguous next renewal');
    await expect(
      resource.approve(preview.id, { idempotencyKey: 'ambiguous-next-renewal' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    const providerCalls = provider.outcomeCalls;

    await expect(
      resource.resolve(preview.id, {
        idempotencyKey: 'resolve-next-renewal-applied',
        outcome: 'applied',
        evidenceReference: 'provider-dashboard-next-renewal',
      }),
    ).resolves.toMatchObject({ status: 'pending_renewal', appliedAt: null });
    const [historicalItem] = await storage.subscriptionItems.listBySubscription(
      subscription.id,
      TENANT,
    );
    expect(historicalItem?.priceId).toBe(source.id);
    await expect(
      database('payable_subscription_mutation_claims').where({ subscription_id: subscription.id }),
    ).resolves.toHaveLength(1);
    clock.set(renewalDate);
    await expect(
      resource.settle(preview.id, { idempotencyKey: 'settle-resolved-next-renewal' }),
    ).resolves.toMatchObject({ status: 'applied', reconciliationOutcome: 'applied' });
    expect(provider.outcomeCalls).toBe(providerCalls);
    const [settledItem] = await storage.subscriptionItems.listBySubscription(
      subscription.id,
      TENANT,
    );
    expect(settledItem?.priceId).toBe(target.id);
    await expect(
      database('payable_subscription_mutation_claims').where({ subscription_id: subscription.id }),
    ).resolves.toHaveLength(0);
  });
});
