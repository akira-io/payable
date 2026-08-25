import { afterEach, describe, expect, it } from 'vitest';
import type { SubscriptionMutationOperation } from '../src/domain/contracts';
import {
  type MigrationPreviewDatabase,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

const nonProjectingOperations = [
  'subscription_cancel',
  'subscription_cancel_now',
  'subscription_cancel_scheduled_change',
  'subscription_pause',
  'subscription_pause_payment_collection',
  'subscription_resume',
  'subscription_resume_paused',
  'subscription_resume_payment_collection',
  'subscription_change_apply',
] as const satisfies readonly SubscriptionMutationOperation[];

describe('lifecycle mutation claim reconciliation matrix', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it.each([
    'applied',
    'not_applied',
  ] as const)('resolves every non-projecting operation after an ambiguous %s outcome', async (outcome) => {
    const { payable, storage, subscription } = await setupMigrationPreview(databases);
    for (const [index, operation] of nonProjectingOperations.entries()) {
      const claimReference = `operation-resolution:${outcome}:${operation}`;
      await expect(
        storage.subscriptionMutationClaims.acquire({
          claimReference,
          tenantId: TENANT,
          subscriptionId: subscription.id,
          ownerToken: `owner-${outcome}-${index}`,
          operation,
          correlationId: `correlation-${outcome}-${index}`,
          intent: null,
          claimedAt: new Date('2026-08-25T10:00:00.000Z'),
        }),
      ).resolves.toBe(true);
      await expect(
        payable.subscriptionMutationClaims(TENANT).resolve(claimReference, {
          idempotencyKey: `resolve-${outcome}-${index}`,
          outcome,
          evidenceReference: `operator-evidence-${outcome}-${index}`,
        }),
      ).resolves.toMatchObject({ status: 'resolved', resolutionOutcome: outcome });
      await expect(
        storage.subscriptionMutationClaims.findActiveBySubscriptionId(subscription.id, TENANT),
      ).resolves.toBeNull();
    }
  });
});
