import { afterEach, describe, expect, it } from 'vitest';
import type { UpdateSubscriptionInput } from '../src/domain/dtos/subscription.dto';
import {
  MigrationOutcomePreviewProvider,
  type MigrationPreviewDatabase,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

const policies = {
  effectiveTiming: 'immediate' as const,
  prorationPolicy: 'prorateImmediately' as const,
  paymentFailurePolicy: 'preventChange' as const,
};

describe('direct subscription mutation claim resolution', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('retains an ambiguous quantity claim and projects it only after exact-owner confirmation', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { database, payable, storage, subscription } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const originalUpdate = provider.updateSubscription.bind(provider);
    let calls = 0;
    provider.updateSubscription = async (input: UpdateSubscriptionInput, context) => {
      calls += 1;
      if (calls === 1) throw new Error('raw direct timeout');
      return originalUpdate(input, context);
    };

    const error = await payable
      .subscription(subscription.id, TENANT)
      .updateQuantity({ quantity: 2, ...policies })
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
      correlationId: expect.any(String),
      context: { claimReference: expect.any(String) },
    });
    expect((error as Error).cause).toBeUndefined();
    const recovery = error as {
      correlationId: string;
      context: { claimReference: string };
    };
    const claimReference = recovery.context.claimReference;
    const resource = payable.subscriptionMutationClaims(TENANT);
    await expect(resource.retrieve(claimReference)).resolves.toMatchObject({
      claimReference,
      subscriptionId: subscription.id,
      operation: 'subscription_quantity_update',
      status: 'active',
    });
    await expect(
      payable.subscription(subscription.id, TENANT).updateQuantity({ quantity: 3, ...policies }),
    ).rejects.toMatchObject({
      code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
      correlationId: recovery.correlationId,
      context: { claimReference },
    });
    expect(calls).toBe(1);
    await expect(
      resource.resolve(`${claimReference}-wrong`, {
        idempotencyKey: 'resolve-wrong-owner',
        outcome: 'applied',
        evidenceReference: 'operator-check-1',
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MUTATION_CLAIM_CONFLICT' });
    await expect(
      resource.resolve(claimReference, {
        idempotencyKey: 'retain-unknown',
        outcome: 'unknown',
        evidenceReference: 'operator-check-inconclusive',
      }),
    ).resolves.toMatchObject({
      status: 'active',
      resolutionOutcome: null,
      observationOutcome: 'unknown',
      observationEvidenceReference: 'operator-check-inconclusive',
      observedAt: expect.any(Date),
    });
    await expect(
      database('payable_subscription_mutation_claims')
        .where({ claim_reference: claimReference })
        .first(),
    ).resolves.toMatchObject({
      active_subscription_id: subscription.id,
      observation_outcome: 'unknown',
      observation_evidence_reference: 'operator-check-inconclusive',
    });
    await expect(
      database('payable_outbox_events')
        .where({ dedupe_key: `subscription-mutation-claim:${claimReference}:observed` })
        .first(),
    ).resolves.toBeTruthy();
    const resolved = await resource.resolve(claimReference, {
      idempotencyKey: 'confirm-direct-applied',
      outcome: 'applied',
      evidenceReference: 'provider-dashboard-event-88',
    });
    expect(resolved).toMatchObject({
      status: 'resolved',
      resolutionOutcome: 'applied',
      resolutionEvidenceReference: 'provider-dashboard-event-88',
    });
    expect(calls).toBe(1);
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.quantity).toBe(2);
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      acceptedQuantity: 2,
      quantity: 2,
    });
  });

  it('releases a confirmed-not-applied claim without changing the local item', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { payable, storage, subscription } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    provider.updateSubscription = async () => {
      throw new Error('raw direct timeout');
    };
    const error = await payable
      .subscription(subscription.id, TENANT)
      .updateQuantity({ quantity: 4, ...policies })
      .catch((reason: unknown) => reason);
    const claimReference = (error as { context: { claimReference: string } }).context
      .claimReference;

    await expect(
      payable.subscriptionMutationClaims(TENANT).resolve(claimReference, {
        idempotencyKey: 'confirm-direct-not-applied',
        outcome: 'not_applied',
        evidenceReference: 'provider-dashboard-event-89',
      }),
    ).resolves.toMatchObject({ status: 'resolved', resolutionOutcome: 'not_applied' });
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.quantity).toBe(1);
  });

  it('accepts an already-projected exact target and rejects a mismatched third state', async () => {
    const ambiguousSetup = async () => {
      const provider = new MigrationOutcomePreviewProvider();
      provider.updateSubscription = async () => {
        throw new Error('ambiguous direct timeout');
      };
      return setupMigrationPreview(databases, 'stripe', provider);
    };
    const first = await ambiguousSetup();
    const firstError = await first.payable
      .subscription(first.subscription.id, TENANT)
      .updateQuantity({ quantity: 3, ...policies })
      .catch((error: unknown) => error);
    const firstReference = (firstError as { context: { claimReference: string } }).context
      .claimReference;
    const [firstItem] = await first.storage.subscriptionItems.listBySubscription(
      first.subscription.id,
      TENANT,
    );
    if (!firstItem) throw new Error('Expected first subscription item');
    await first.storage.subscriptionItems.updateById(
      first.subscription.id,
      firstItem.id,
      { quantity: 3 },
      TENANT,
    );
    await first.storage.subscriptions.update(
      first.subscription.id,
      { quantity: 3, acceptedQuantity: 3 },
      TENANT,
    );
    await expect(
      first.payable.subscriptionMutationClaims(TENANT).resolve(firstReference, {
        idempotencyKey: 'webhook-projected-first',
        outcome: 'applied',
        evidenceReference: 'webhook-event-44',
      }),
    ).resolves.toMatchObject({ status: 'resolved', resolutionOutcome: 'applied' });

    const second = await ambiguousSetup();
    const secondError = await second.payable
      .subscription(second.subscription.id, TENANT)
      .updateQuantity({ quantity: 3, ...policies })
      .catch((error: unknown) => error);
    const secondReference = (secondError as { context: { claimReference: string } }).context
      .claimReference;
    const [secondItem] = await second.storage.subscriptionItems.listBySubscription(
      second.subscription.id,
      TENANT,
    );
    if (!secondItem) throw new Error('Expected second subscription item');
    await second.storage.subscriptionItems.updateById(
      second.subscription.id,
      secondItem.id,
      { quantity: 4 },
      TENANT,
    );
    await expect(
      second.payable.subscriptionMutationClaims(TENANT).resolve(secondReference, {
        idempotencyKey: 'conflicting-third-state',
        outcome: 'applied',
        evidenceReference: 'provider-dashboard-44',
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MUTATION_CLAIM_CONFLICT' });
    await expect(
      second.payable.subscriptionMutationClaims(TENANT).retrieve(secondReference),
    ).resolves.toMatchObject({ status: 'active' });
  });

  it('returns a safe retained claim when local projection fails after provider success', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { database, payable, storage, subscription } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const originalUpdate = provider.updateSubscription.bind(provider);
    let calls = 0;
    provider.updateSubscription = async (input: UpdateSubscriptionInput, context) => {
      calls += 1;
      return originalUpdate(input, context);
    };
    await database.raw(`
      CREATE TRIGGER fail_direct_projection
      BEFORE UPDATE ON payable_subscription_items
      BEGIN
        SELECT RAISE(ABORT, 'local projection failed');
      END
    `);

    const error = await payable
      .subscription(subscription.id, TENANT)
      .updateQuantity({ quantity: 2, ...policies })
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
      context: { claimReference: expect.any(String) },
    });
    expect((error as Error).cause).toBeUndefined();
    expect(calls).toBe(1);
    const claimReference = (error as { context: { claimReference: string } }).context
      .claimReference;
    await expect(
      payable.subscriptionMutationClaims(TENANT).retrieve(claimReference),
    ).resolves.toMatchObject({ status: 'active' });
    await database.raw('DROP TRIGGER fail_direct_projection');

    await expect(
      payable.subscriptionMutationClaims(TENANT).resolve(claimReference, {
        idempotencyKey: 'resolve-after-local-projection-failure',
        outcome: 'applied',
        evidenceReference: 'operator-confirmed-provider-success',
      }),
    ).resolves.toMatchObject({ status: 'resolved', resolutionOutcome: 'applied' });
    expect(calls).toBe(1);
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.quantity).toBe(2);
  });
});
