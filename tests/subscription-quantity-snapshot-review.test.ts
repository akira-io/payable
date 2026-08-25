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

describe('successful subscription quantity snapshots', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('updates a canonical accepted quantity and remains eligible for the next preview', async () => {
    const { payable, storage, subscription, source } = await setupMigrationPreview(databases);

    await expect(
      payable.subscription(subscription.id, TENANT).updateQuantity({ quantity: 3, ...policies }),
    ).resolves.toMatchObject({ quantity: 3, acceptedQuantity: 3 });
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      quantity: 3,
      acceptedQuantity: 3,
    });
    await expect(
      payable.subscriptionPriceMigrations(TENANT).preview({
        ...migrationPreviewInput,
        idempotencyKey: 'preview-after-successful-quantity-update',
        subscriptionId: subscription.id,
        targetPriceId: source.id,
        quantity: 4,
      }),
    ).resolves.toMatchObject({
      sourcePriceId: source.id,
      targetPriceId: source.id,
      proposedItems: [expect.objectContaining({ quantity: 4 })],
    });
  });

  it('preserves a provider-native null accepted quantity after success', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { payable, storage, subscription } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    await storage.subscriptions.update(subscription.id, { acceptedQuantity: null }, TENANT);

    await expect(
      payable.subscription(subscription.id, TENANT).updateQuantity({ quantity: 3, ...policies }),
    ).resolves.toMatchObject({ quantity: 3, acceptedQuantity: null });
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      quantity: 3,
      acceptedQuantity: null,
    });
  });
});
