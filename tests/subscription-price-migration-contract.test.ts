import { describe, expect, it } from 'vitest';
// @ts-expect-error Raw provider execution evidence is internal and not root-exported.
import type { SubscriptionPriceMigrationExecutionEvidence } from '../src';
import {
  isSubscriptionPriceMigrationStatus,
  rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob,
  SUBSCRIPTION_PRICE_MIGRATION_STATUSES,
  type SubscriptionPriceMigration,
  type SubscriptionPriceMigrationExecutionEvidenceBlob,
} from '../src';
import type {
  NewSubscriptionPriceMigration,
  SubscriptionPriceMigrationRepository,
  SubscriptionPriceMigrationStateCompareAndSwap,
} from '../src/domain/contracts/subscription-price-migration-repository.contract';
import type { KnexSubscriptionPriceMigrationRepository } from '../src/infrastructure/storage/knex/repositories/knex-subscription-price-migration.repository';
import type { PrismaSubscriptionPriceMigrationRepository } from '../src/infrastructure/storage/prisma/repositories/prisma-subscription-price-migrations.repository';

const now = new Date('2026-08-25T12:00:00.000Z');

const newMigrationBase: Omit<NewSubscriptionPriceMigration, 'effectiveAt' | 'effectiveTiming'> = {
  tenantId: 'tenant_1',
  subscriptionId: 'subscription_1',
  primaryItemId: 'item_1',
  sourcePriceId: 'price_old',
  targetPriceId: 'price_new',
  sourcePrice: {
    id: 'price_old',
    productId: 'product_1',
    amount: 1_000,
    currency: 'USD',
    interval: 'month',
    intervalCount: 1,
  },
  targetPrice: {
    id: 'price_new',
    productId: 'product_1',
    amount: 2_000,
    currency: 'USD',
    interval: 'month',
    intervalCount: 1,
  },
  currentItems: [{ id: 'item_1', priceId: 'price_old', quantity: 1 }],
  proposedItems: [{ id: 'item_1', priceId: 'price_new', quantity: 1 }],
  prorationPolicy: 'prorateImmediately',
  paymentFailurePolicy: 'preventChange',
  immediateAdjustment: { direction: 'charge', amount: 500, currency: 'USD' },
  nextRenewal: { amount: 2_000, currency: 'USD', date: now },
  currentRenewalDate: now,
  warnings: [],
  providerLimitations: [],
  previewToken: 'preview_1',
  requestHash: 'hash_1',
  calculatedAt: now,
  expiresAt: now,
  providerBindingId: 'binding_1',
  status: 'previewed',
  attemptCount: 0,
  executionToken: null,
  failureCode: null,
  failureMessage: null,
  scheduledAt: null,
  executionStartedAt: null,
  appliedAt: null,
  failedAt: null,
  reconciliationRequiredAt: null,
  reconciliationOutcome: null,
  reconciliationEvidenceReference: null,
  reconciliationResolvedAt: null,
  reconciliationObservationEvidenceReference: null,
  reconciliationObservedAt: null,
  cancelledAt: null,
};

const scheduledMigration: NewSubscriptionPriceMigration = {
  ...newMigrationBase,
  effectiveTiming: 'scheduled',
  effectiveAt: now,
};

declare const executionEvidence: SubscriptionPriceMigrationExecutionEvidenceBlob;

const migrationCreatedScheduled: NewSubscriptionPriceMigration = {
  ...scheduledMigration,
  // @ts-expect-error New migrations are immutable previews, never pre-scheduled records.
  status: 'scheduled',
  // @ts-expect-error New migrations cannot begin with a lifecycle timestamp.
  scheduledAt: now,
};

const migrationCreatedClaimed: NewSubscriptionPriceMigration = {
  ...scheduledMigration,
  // @ts-expect-error New previews cannot begin with attempts.
  attemptCount: 1,
  // @ts-expect-error New previews cannot begin with an execution claim.
  executionToken: 'owner_1',
};

// @ts-expect-error Scheduled migrations require an effective date.
const scheduledMigrationWithoutEffectiveAt: NewSubscriptionPriceMigration = {
  ...newMigrationBase,
  effectiveTiming: 'scheduled',
  effectiveAt: null,
};

// @ts-expect-error Previewed migrations cannot become applied.
const invalidLifecycleCas: SubscriptionPriceMigrationStateCompareAndSwap = {
  id: 'migration_1',
  tenantId: 'tenant_1',
  expectedStatus: 'previewed',
  expectedExecutionToken: null,
  nextStatus: 'applied',
  executionToken: null,
  attemptCount: 0,
  failureCode: null,
  failureMessage: null,
  executionStartedAt: null,
  appliedAt: now,
  failedAt: null,
  reconciliationRequiredAt: null,
  cancelledAt: null,
  updatedAt: now,
};

// @ts-expect-error Executing completions require a non-null ownership token.
const executingWithoutClaimCas: SubscriptionPriceMigrationStateCompareAndSwap = {
  ...invalidLifecycleCas,
  expectedStatus: 'executing',
  expectedExecutionToken: null,
  nextStatus: 'applied',
  executionToken: null,
};

// @ts-expect-error Scheduling persists its timestamp in the same CAS update.
const schedulingWithoutTimestampCas: SubscriptionPriceMigrationStateCompareAndSwap = {
  ...invalidLifecycleCas,
  expectedStatus: 'previewed',
  expectedExecutionToken: null,
  nextStatus: 'scheduled',
  executionToken: null,
};

const failedExecutionClearingClaim: SubscriptionPriceMigrationStateCompareAndSwap = {
  ...invalidLifecycleCas,
  expectedStatus: 'executing',
  expectedExecutionToken: 'owner_1',
  nextStatus: 'failed',
  executionToken: null,
};

// @ts-expect-error Starting only claims an unowned preview, schedule, or failed attempt.
const startingWithExistingClaim: SubscriptionPriceMigrationStateCompareAndSwap = {
  ...invalidLifecycleCas,
  expectedStatus: 'failed',
  expectedExecutionToken: 'owner_1',
  nextStatus: 'executing',
  executionToken: 'owner_2',
};

// @ts-expect-error Cancellation only matches an unowned migration.
const cancellingClaimedMigration: SubscriptionPriceMigrationStateCompareAndSwap = {
  ...invalidLifecycleCas,
  expectedStatus: 'failed',
  expectedExecutionToken: 'owner_1',
  nextStatus: 'cancelled',
  executionToken: null,
};

// @ts-expect-error Cancellation cannot retain or introduce an owner.
const cancellationRetainingClaim: SubscriptionPriceMigrationStateCompareAndSwap = {
  ...invalidLifecycleCas,
  expectedStatus: 'failed',
  expectedExecutionToken: null,
  nextStatus: 'cancelled',
  executionToken: 'owner_1',
};

const assertExecutionClaimTokensMatch = (repository: SubscriptionPriceMigrationRepository) => {
  // @ts-expect-error Execution completion must keep the same ownership token.
  repository.compareAndSwapState({
    ...invalidLifecycleCas,
    expectedStatus: 'executing',
    expectedExecutionToken: 'owner_1',
    nextStatus: 'applied',
    executionToken: 'owner_2',
  });
};

const assertRepositoryPersistsExecutionEvidence = async (
  repository: SubscriptionPriceMigrationRepository,
) => {
  await repository.createWithExecutionEvidence(scheduledMigration, executionEvidence);
  return repository.findExecutionEvidenceById('migration_1', 'tenant_1');
};

const assertConcreteRepositoriesAreImmutable = (
  repository: KnexSubscriptionPriceMigrationRepository | PrismaSubscriptionPriceMigrationRepository,
) => {
  // @ts-expect-error Canonical migration repositories expose no generic update path.
  repository.update('migration_1', { status: 'applied' }, 'tenant_1');
};

const assertPublicMigrationIsProviderNeutral = (migration: SubscriptionPriceMigration) => {
  // @ts-expect-error Canonical migrations do not expose internal provider execution evidence.
  migration.providerEvidence;
  // @ts-expect-error Canonical migrations do not expose provider routing identifiers.
  migration.provider;
  // @ts-expect-error Canonical migrations do not expose provider subscription identifiers.
  migration.providerSubscriptionId;
  const item = migration.currentItems[0];
  if (!item) return;
  // @ts-expect-error Canonical migration item snapshots do not expose provider item identifiers.
  item.providerItemId;
  // @ts-expect-error Canonical migration item snapshots do not expose provider-native price ids.
  item.providerPriceId;
};

void scheduledMigration;
void scheduledMigrationWithoutEffectiveAt;
void executingWithoutClaimCas;
void schedulingWithoutTimestampCas;
void failedExecutionClearingClaim;
void migrationCreatedScheduled;
void migrationCreatedClaimed;
void startingWithExistingClaim;
void cancellingClaimedMigration;
void cancellationRetainingClaim;
void assertExecutionClaimTokensMatch;
void assertRepositoryPersistsExecutionEvidence;
void assertConcreteRepositoriesAreImmutable;
void assertPublicMigrationIsProviderNeutral;
void (undefined as unknown as SubscriptionPriceMigrationExecutionEvidence);

describe('subscription price migration public contract', () => {
  it('exports migration statuses and their runtime guard from the root package', () => {
    expect(SUBSCRIPTION_PRICE_MIGRATION_STATUSES).toContain('reconciliation_required');
    expect(isSubscriptionPriceMigrationStatus('scheduled')).toBe(true);
    expect(isSubscriptionPriceMigrationStatus('invalid')).toBe(false);
  });

  it('keeps invalid lifecycle CAS pairs out of the public contract', () => {
    expect(invalidLifecycleCas.nextStatus).toBe('applied');
  });

  it('rehydrates only non-empty versioned opaque storage blobs', () => {
    const stored = 'payable:subscription-price-migration-evidence:v1:{"opaque":true}';

    expect(rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob(stored)).toBe(stored);
    expect(() => rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob('')).toThrow(TypeError);
    expect(() =>
      rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob(
        'payable:subscription-price-migration-evidence:v2:{"opaque":true}',
      ),
    ).toThrow(TypeError);
  });
});
