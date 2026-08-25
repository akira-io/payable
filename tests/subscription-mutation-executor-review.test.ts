import { afterEach, describe, expect, it } from 'vitest';
import { executeSubscriptionMutation } from '../src/application/services/subscriptions/execute-subscription-mutation';
import {
  type MigrationPreviewDatabase,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

describe('shared subscription mutation executor', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('releases only a definitive returned no-side-effect result and retains an ambiguous throw', async () => {
    const { storage, subscription } = await setupMigrationPreview(databases);
    const base = {
      storage,
      tenantId: TENANT,
      subscriptionId: subscription.id,
      operation: 'subscription_cancel' as const,
      context: { correlationId: 'executor-review-correlation', idempotencyKey: 'executor-review' },
      claimedAt: new Date('2026-08-25T10:00:00.000Z'),
      persist: async () => subscription,
    };
    const rejected = new Error('canonical definitive rejection');
    await expect(
      executeSubscriptionMutation({
        ...base,
        callProvider: async () => ({ kind: 'not_applied', error: rejected }),
      }),
    ).rejects.toBe(rejected);
    await expect(
      storage.subscriptionMutationClaims.findActiveBySubscriptionId(subscription.id, TENANT),
    ).resolves.toBeNull();

    await expect(
      executeSubscriptionMutation({
        ...base,
        callProvider: async () => {
          throw new Error('raw provider timeout');
        },
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED' });
    await expect(
      storage.subscriptionMutationClaims.findActiveBySubscriptionId(subscription.id, TENANT),
    ).resolves.toMatchObject({ status: 'active', operation: 'subscription_cancel' });
  });
});
