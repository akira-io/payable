import { afterEach, describe, expect, it } from 'vitest';
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

describe('provider-native quantity claim resolution', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it.each([
    false,
    true,
  ])('preserves a null canonical accepted quantity when webhook-first is %s', async (webhookFirst) => {
    const provider = new MigrationOutcomePreviewProvider();
    provider.updateSubscription = async () => {
      throw new Error('ambiguous provider-native quantity timeout');
    };
    const { payable, storage, subscription } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    await storage.subscriptions.update(subscription.id, { acceptedQuantity: null }, TENANT);
    const error = await payable
      .subscription(subscription.id, TENANT)
      .updateQuantity({ quantity: 3, ...policies })
      .catch((reason: unknown) => reason);
    const claimReference = (error as { context: { claimReference: string } }).context
      .claimReference;
    if (webhookFirst) {
      const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
      if (!item) throw new Error('Expected provider-native subscription item');
      await storage.subscriptionItems.updateById(subscription.id, item.id, { quantity: 3 }, TENANT);
      await storage.subscriptions.update(subscription.id, { quantity: 3 }, TENANT);
    }

    await expect(
      payable.subscriptionMutationClaims(TENANT).resolve(claimReference, {
        idempotencyKey: `resolve-null-accepted-${webhookFirst}`,
        outcome: 'applied',
        evidenceReference: `operator-null-accepted-${webhookFirst}`,
      }),
    ).resolves.toMatchObject({ status: 'resolved', resolutionOutcome: 'applied' });
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.quantity).toBe(3);
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      quantity: 3,
      acceptedQuantity: null,
    });
  });
});
