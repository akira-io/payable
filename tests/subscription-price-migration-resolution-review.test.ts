import { afterEach, describe, expect, it } from 'vitest';
import type { UpdateSubscriptionInput } from '../src/domain/dtos/subscription.dto';
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

describe('subscription price migration reconciliation resolution', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('resolves a retained claim as not applied without a provider call and replays exactly', async () => {
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
    provider.outcomeError = new Error('raw provider timeout');
    const rejected = await resource
      .approve(preview.id, { idempotencyKey: 'ambiguous-before-resolution' })
      .catch((error: unknown) => error);
    expect(rejected).toMatchObject({
      code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED',
    });
    expect((rejected as Error).cause).toBeUndefined();
    const calls = provider.outcomeCalls;
    const evidenceReference = 'e'.repeat(512);
    const input = {
      idempotencyKey: 'resolve-not-applied',
      outcome: 'not_applied' as const,
      evidenceReference,
    };

    await expect(resource.resolve(preview.id, input)).resolves.toMatchObject({
      status: 'failed',
      executionToken: null,
      failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
      reconciliationOutcome: 'not_applied',
      reconciliationEvidenceReference: evidenceReference,
    });
    await expect(resource.resolve(preview.id, input)).resolves.toMatchObject({ status: 'failed' });
    await expect(
      resource.resolve(preview.id, {
        idempotencyKey: 'conflicting-resolution',
        outcome: 'applied',
        evidenceReference: 'host-audit-43',
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' });
    expect(provider.outcomeCalls).toBe(calls);
    await expect(
      database('payable_subscription_mutation_claims').where({ subscription_id: subscription.id }),
    ).resolves.toHaveLength(0);
    provider.outcomeError = undefined;
    await expect(
      resource.retry(preview.id, { idempotencyKey: 'retry-after-confirmed-not-applied' }),
    ).resolves.toMatchObject({ status: 'applied', attemptCount: 2 });
    expect(provider.outcomeCalls).toBe(calls + 1);
  });

  it('projects an operator-confirmed applied outcome without another provider call', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { database, payable, storage, subscription, source, target } =
      await setupMigrationPreview(databases, 'stripe', provider);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'preview-resolve-applied',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.outcome = {
      kind: 'applied',
      subscription: {
        providerSubscriptionId: 'sub_wrong',
        status: 'active',
        currentPeriodEnd: null,
        trialEndsAt: null,
      },
    };
    await expect(
      resource.approve(preview.id, { idempotencyKey: 'ambiguous-identity' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    const calls = provider.outcomeCalls;

    await expect(
      resource.resolve(preview.id, {
        idempotencyKey: 'resolve-applied',
        outcome: 'applied',
        evidenceReference: 'provider-dashboard-event-7',
      }),
    ).resolves.toMatchObject({
      status: 'applied',
      reconciliationOutcome: 'applied',
    });
    expect(provider.outcomeCalls).toBe(calls);
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.priceId).toBe(target.id);
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      canonicalPriceId: target.id,
    });
    await expect(
      database('payable_subscription_mutation_claims').where({ subscription_id: subscription.id }),
    ).resolves.toHaveLength(0);
    expect(source.id).not.toBe(target.id);
  });
});

describe('subscription mutation claims and stable primary identity', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('blocks a direct mutation while a canonical provider call owns the durable claim', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { payable, subscription, target } = await setupMigrationPreview(
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
    let release!: () => void;
    let started!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const providerStarted = new Promise<void>((resolve) => (started = resolve));
    provider.beforeApply = async () => {
      started();
      await barrier;
    };

    const canonical = migrations.approve(preview.id, { idempotencyKey: 'canonical-owner' });
    await providerStarted;
    await expect(
      payable.subscription(subscription.id, TENANT).updateQuantity({ quantity: 2, ...policies }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED' });
    expect(provider.lastSubscriptionUpdate).toBeUndefined();
    release();
    await expect(canonical).resolves.toMatchObject({ status: 'applied' });
  });

  it('blocks canonical execution while a direct provider call owns the durable claim', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { payable, subscription, target } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    let release!: () => void;
    let started!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const providerStarted = new Promise<void>((resolve) => (started = resolve));
    const originalUpdate = provider.updateSubscription.bind(provider);
    provider.updateSubscription = async (input: UpdateSubscriptionInput, context) => {
      started();
      await barrier;
      return originalUpdate(input, context);
    };
    const direct = payable
      .subscription(subscription.id, TENANT)
      .updateQuantity({ quantity: 2, ...policies });
    await providerStarted;
    const migrations = payable.subscriptionPriceMigrations(TENANT);
    const preview = await migrations.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'preview-during-direct',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });

    await expect(
      migrations.approve(preview.id, { idempotencyKey: 'canonical-blocked' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED' });
    expect(provider.outcomeCalls).toBe(0);
    release();
    await direct;
  });

  it('retains a direct mutation claim after an ambiguous provider throw', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { payable, subscription, target } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    provider.updateSubscription = async () => {
      throw new Error('direct provider timeout');
    };

    await expect(
      payable.subscription(subscription.id, TENANT).updateQuantity({ quantity: 2, ...policies }),
    ).rejects.toMatchObject({
      code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
      context: { claimReference: expect.any(String) },
    });
    const migrations = payable.subscriptionPriceMigrations(TENANT);
    const preview = await migrations.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'preview-after-direct-timeout',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    await expect(
      migrations.approve(preview.id, { idempotencyKey: 'blocked-after-direct-timeout' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED' });
    expect(provider.outcomeCalls).toBe(0);
  });

  it('uses explicit primary item identity when two items share the source price', async () => {
    const { payable, storage, source, target, subscription } =
      await setupMigrationPreview(databases);
    const secondary = await storage.subscriptionItems.create({
      subscriptionId: subscription.id,
      priceId: source.id,
      providerItemId: 'si_secondary_same_price',
      quantity: 2,
    });
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'duplicate-source-secondary',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
      itemId: secondary.id,
      quantity: 3,
    });
    expect(preview.primaryItemId).not.toBe(secondary.id);

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'apply-duplicate-source-secondary' }),
    ).resolves.toMatchObject({ status: 'applied' });
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      canonicalPriceId: source.id,
      acceptedQuantity: 1,
    });
    const items = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(items.find(({ id }) => id === secondary.id)).toMatchObject({
      priceId: target.id,
      quantity: 3,
    });
  });
});
