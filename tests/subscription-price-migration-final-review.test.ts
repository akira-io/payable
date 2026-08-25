import { afterEach, describe, expect, it } from 'vitest';
import {
  MigrationOutcomePreviewProvider,
  type MigrationPreviewDatabase,
  migrationPreviewInput,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

const policies = {
  effectiveTiming: 'immediate' as const,
  prorationPolicy: 'prorateImmediately' as const,
  paymentFailurePolicy: 'preventChange' as const,
};

describe('subscription price migration final review safety', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('rejects renewal-boundary drift before claim or provider mutation', async () => {
    const { payable, provider, storage, subscription, target } =
      await setupMigrationPreview(databases);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    await storage.subscriptions.update(
      subscription.id,
      { currentPeriodEnd: new Date('2026-10-25T00:00:00.000Z') },
      TENANT,
    );

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'renewal-boundary-drift' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_PREVIEW_STALE' });
    await expect(resource.retrieve(preview.id)).resolves.toMatchObject({
      status: 'previewed',
      attemptCount: 0,
      executionToken: null,
    });
    expect(provider.applyCalls).toBe(0);
  });

  it('treats an applied outcome for another provider subscription as ambiguous', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { database, payable, subscription, target } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.outcome = {
      kind: 'applied',
      subscription: {
        providerSubscriptionId: 'sub_other',
        status: 'active',
        currentPeriodEnd: null,
        trialEndsAt: null,
      },
    };

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'provider-identity-mismatch' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    await expect(resource.retrieve(preview.id)).resolves.toMatchObject({
      status: 'reconciliation_required',
      failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_IDENTITY_MISMATCH',
    });
    await expect(
      database('payable_subscription_price_migrations')
        .where({ id: preview.id })
        .first('active_subscription_id'),
    ).resolves.toMatchObject({ active_subscription_id: subscription.id });
  });

  it('sanitizes a definitive provider rejection in the facade entity and error', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { payable, subscription, target } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.outcome = {
      kind: 'not_applied',
      sideEffects: 'definitively_none',
      code: 'RAW_PROVIDER_CARD_DECLINED',
      message: 'Raw processor explanation',
    };

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'sanitized-provider-rejection' }),
    ).rejects.toMatchObject({
      code: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
      message: 'Provider did not apply the subscription migration',
    });
    const failed = await resource.retrieve(preview.id);
    expect(failed).toMatchObject({
      status: 'failed',
      failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
      failureMessage: 'Provider did not apply the subscription migration',
    });
    expect(JSON.stringify(failed)).not.toMatch(/RAW_PROVIDER_CARD_DECLINED|Raw processor/u);
  });

  it('keeps reconciliation fenced across new previews and direct mutations', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { database, payable, subscription, target } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const migrations = payable.subscriptionPriceMigrations(TENANT);
    const preview = await migrations.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.outcomeError = new Error('ambiguous provider failure');
    await expect(
      migrations.approve(preview.id, { idempotencyKey: 'create-reconciliation-fence' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    const previewCalls = provider.previewCalls;

    await expect(
      migrations.preview({
        ...migrationPreviewInput,
        idempotencyKey: 'blocked-second-preview',
        subscriptionId: subscription.id,
        targetPriceId: target.id,
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' });
    const resource = payable.subscription(subscription.id, TENANT);
    await expect(resource.swap({ priceId: target.id, ...policies })).rejects.toMatchObject({
      code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
      correlationId: expect.any(String),
      context: { claimReference: expect.any(String) },
    });
    await expect(resource.updateQuantity({ quantity: 2, ...policies })).rejects.toMatchObject({
      code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
      correlationId: expect.any(String),
      context: { claimReference: expect.any(String) },
    });
    expect(provider.previewCalls).toBe(previewCalls);
    expect(provider.lastSubscriptionUpdate).toBeUndefined();
    await expect(
      database('payable_subscription_price_migrations')
        .where({ id: preview.id })
        .first('active_subscription_id'),
    ).resolves.toMatchObject({ active_subscription_id: subscription.id });
  });
});
