import { afterEach, describe, expect, it } from 'vitest';
import { PayableError } from '../src/domain/errors/payable-error';
import {
  MigrationOutcomePreviewProvider,
  type MigrationPreviewDatabase,
  migrationPreviewInput,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

describe('canonical subscription price migration lifecycle safety', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('durably fences a confirmed failed retry under the same lifecycle idempotency key', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { payable, clock, subscription, target } = await setupMigrationPreview(
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
      code: 'PROVIDER_REJECTED',
    };
    await expect(
      resource.approve(preview.id, { idempotencyKey: 'initial-confirmed-rejection' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED' });

    await expect(
      resource.retry(preview.id, { idempotencyKey: 'same-confirmed-retry' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED' });
    clock.advance(31_000);
    await expect(
      resource.retry(preview.id, { idempotencyKey: 'same-confirmed-retry' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_RECONCILIATION_REQUIRED' });

    await expect(resource.retrieve(preview.id)).resolves.toMatchObject({
      status: 'failed',
      attemptCount: 2,
    });
    expect(provider.outcomeCalls).toBe(2);
    expect(provider.applyCalls).toBe(0);
  });

  it('makes an explicit not-applied outcome failed and retryable with a new key', async () => {
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
      code: 'PROVIDER_REJECTED',
      message: 'Provider definitively rejected the change',
    };

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'outcome-not-applied' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED' });
    await expect(resource.retrieve(preview.id)).resolves.toMatchObject({
      status: 'failed',
      executionToken: null,
      attemptCount: 1,
      failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
    });

    provider.outcome = undefined;
    await expect(
      resource.retry(preview.id, { idempotencyKey: 'outcome-applied-retry' }),
    ).resolves.toMatchObject({ status: 'applied', attemptCount: 2 });
    expect(provider.outcomeCalls).toBe(2);
    expect(provider.applyCalls).toBe(0);
  });

  it.each([
    ['missing', undefined],
    ['unknown', 'unknown'],
    ['partial', 'partially_none'],
  ] as const)('treats a %s no-side-effect marker as ambiguous', async (_label, sideEffects) => {
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
      code: 'PROVIDER_REJECTED',
      ...(sideEffects === undefined ? {} : { sideEffects }),
    } as unknown as NonNullable<MigrationOutcomePreviewProvider['outcome']>;

    await expect(
      resource.approve(preview.id, { idempotencyKey: `invalid-side-effects-${_label}` }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    await expect(resource.retrieve(preview.id)).resolves.toMatchObject({
      status: 'reconciliation_required',
      executionToken: expect.any(String),
      failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_OUTCOME_UNKNOWN',
    });
    expect(provider.outcomeCalls).toBe(1);
    expect(provider.applyCalls).toBe(0);
  });

  it('projects an explicit applied outcome without calling the legacy method', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { payable, storage, subscription, target } = await setupMigrationPreview(
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

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'explicit-applied-outcome' }),
    ).resolves.toMatchObject({ status: 'applied' });
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.priceId).toBe(target.id);
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      canonicalPriceId: target.id,
      acceptedUnitAmount: target.unitAmount,
    });
    expect(provider.outcomeCalls).toBe(1);
    expect(provider.applyCalls).toBe(0);
  });

  it('treats a throw from the explicit outcome method as ambiguous', async () => {
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
    provider.outcomeError = new PayableError('Enhanced provider outcome is unknown', {
      code: 'PROVIDER_RESPONSE_INVALID',
    });

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'enhanced-method-throws' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    await expect(resource.retrieve(preview.id)).resolves.toMatchObject({
      status: 'reconciliation_required',
      executionToken: expect.any(String),
    });
    expect(provider.outcomeCalls).toBe(1);
    expect(provider.applyCalls).toBe(0);
  });

  it('treats every legacy provider throw as ambiguous after mutation starts', async () => {
    const { payable, provider, subscription, target } = await setupMigrationPreview(databases);
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    let mutationStarted = false;
    provider.beforeApply = async () => {
      mutationStarted = true;
    };
    provider.applyError = new PayableError('A thrown error cannot prove mutation rejection', {
      code: 'PROVIDER_REJECTED',
    });

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'mutated-invalid-response' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    expect(mutationStarted).toBe(true);
    await expect(resource.retrieve(preview.id)).resolves.toMatchObject({
      status: 'reconciliation_required',
      executionToken: expect.any(String),
      failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_OUTCOME_UNKNOWN',
    });
    provider.applyError = undefined;
    await expect(
      resource.retry(preview.id, { idempotencyKey: 'no-blind-invalid-response-retry' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    expect(provider.applyCalls).toBe(1);
  });
});
