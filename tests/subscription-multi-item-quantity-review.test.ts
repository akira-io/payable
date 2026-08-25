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

describe('multi-item canonical quantity snapshots', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('advances the primary item snapshot and remains eligible for a canonical migration', async () => {
    const { payable, storage, subscription, source, target } =
      await setupMigrationPreview(databases);
    const [primary] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    if (!primary) throw new Error('Expected primary subscription item');
    await addSecondary(storage, subscription.id, target.id, 'ordinary-primary');

    await payable.subscription(subscription.id, TENANT).updateQuantity({
      quantity: 3,
      itemId: primary.id,
      ...policies,
    });

    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      quantity: 3,
      acceptedQuantity: 3,
    });
    await expect(
      storage.subscriptionItems.listBySubscription(subscription.id, TENANT),
    ).resolves.toContainEqual(expect.objectContaining({ id: primary.id, quantity: 3 }));
    await expect(
      payable.subscriptionPriceMigrations(TENANT).preview({
        ...migrationPreviewInput,
        idempotencyKey: 'preview-after-multi-item-primary-quantity',
        subscriptionId: subscription.id,
        targetPriceId: source.id,
        itemId: primary.id,
        quantity: 4,
      }),
    ).resolves.toMatchObject({
      primaryItemId: primary.id,
      proposedItems: expect.arrayContaining([
        expect.objectContaining({ id: primary.id, quantity: 4 }),
      ]),
    });
  });

  it('updates a secondary item without replacing the primary accepted quantity', async () => {
    const { payable, storage, subscription, target } = await setupMigrationPreview(databases);
    const secondary = await addSecondary(storage, subscription.id, target.id, 'ordinary-secondary');

    await payable.subscription(subscription.id, TENANT).updateQuantity({
      quantity: 4,
      itemId: secondary.id,
      ...policies,
    });

    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      quantity: 1,
      acceptedQuantity: 1,
    });
    await expect(
      storage.subscriptionItems.listBySubscription(subscription.id, TENANT),
    ).resolves.toContainEqual(expect.objectContaining({ id: secondary.id, quantity: 4 }));
  });

  it.each([
    'primary',
    'secondary',
  ] as const)('uses the same %s projection decision during ambiguous applied recovery', async (selection) => {
    const provider = new MigrationOutcomePreviewProvider();
    provider.updateSubscription = async () => {
      throw new Error('ambiguous quantity timeout');
    };
    const { payable, storage, subscription, target } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const [primary] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    if (!primary) throw new Error('Expected primary subscription item');
    const secondary = await addSecondary(
      storage,
      subscription.id,
      target.id,
      `recovery-${selection}`,
    );
    const selected = selection === 'primary' ? primary : secondary;
    const error = await payable
      .subscription(subscription.id, TENANT)
      .updateQuantity({ quantity: 3, itemId: selected.id, ...policies })
      .catch((reason: unknown) => reason);
    const claimReference = (error as { context: { claimReference: string } }).context
      .claimReference;

    await payable.subscriptionMutationClaims(TENANT).resolve(claimReference, {
      idempotencyKey: `resolve-multi-item-${selection}`,
      outcome: 'applied',
      evidenceReference: `operator-confirmed-${selection}`,
    });

    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      quantity: selection === 'primary' ? 3 : 1,
      acceptedQuantity: selection === 'primary' ? 3 : 1,
    });
    await expect(
      storage.subscriptionItems.listBySubscription(subscription.id, TENANT),
    ).resolves.toContainEqual(expect.objectContaining({ id: selected.id, quantity: 3 }));
  });
});

async function addSecondary(
  storage: Awaited<ReturnType<typeof setupMigrationPreview>>['storage'],
  subscriptionId: string,
  priceId: string,
  suffix: string,
) {
  return storage.subscriptionItems.create({
    subscriptionId,
    priceId,
    providerItemId: `si_secondary_${suffix}`,
    quantity: 2,
  });
}
