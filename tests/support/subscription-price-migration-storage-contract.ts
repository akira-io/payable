import type {
  NewSubscriptionPriceMigration,
  StorageDriver,
  SubscriptionPriceMigrationRepository,
} from '../../src/domain/contracts';
import type { SubscriptionPriceMigration } from '../../src/domain/entities';
import type {
  SubscriptionPriceMigrationFailure,
  SubscriptionPriceMigrationFailureCode,
} from '../../src/domain/value-objects/subscription-price-migration-failure';

export const STORAGE_TIME = new Date('2026-08-25T10:00:00.000Z');

interface MigrationCasLifecycleFields {
  attemptCount: number;
  failureCode: SubscriptionPriceMigrationFailureCode | null;
  failureMessage: SubscriptionPriceMigrationFailure['message'] | null;
  executionStartedAt: Date | null;
  appliedAt: Date | null;
  failedAt: Date | null;
  reconciliationRequiredAt: Date | null;
  cancelledAt: Date | null;
  updatedAt: Date;
}

export function migrationCasLifecycle(
  overrides: Partial<MigrationCasLifecycleFields> = {},
): MigrationCasLifecycleFields {
  return {
    attemptCount: 0,
    failureCode: null,
    failureMessage: null,
    executionStartedAt: null,
    appliedAt: null,
    failedAt: null,
    reconciliationRequiredAt: null,
    cancelledAt: null,
    updatedAt: STORAGE_TIME,
    ...overrides,
  };
}

export interface MigrationDependencies {
  subscriptionId: string;
  sourcePriceId: string;
  targetPriceId: string;
  productId: string;
  providerBindingId: string;
}

export async function seedMigrationDependencies(
  storage: StorageDriver,
  tenantId: string,
  suffix: string,
): Promise<MigrationDependencies> {
  if (!storage.canonicalProducts || !storage.canonicalPrices) {
    throw new Error('Canonical catalog repositories are required');
  }
  const customer = await storage.customers.create({
    tenantId,
    billableType: 'Team',
    billableId: `migration-team-${suffix}`,
    email: `${suffix}@migration.example`,
    name: null,
    metadata: null,
  });
  const product = await storage.canonicalProducts.create({
    tenantId,
    name: `Migration product ${suffix}`,
    description: null,
    active: true,
    metadata: null,
  });
  const sourcePrice = await storage.canonicalPrices.create({
    tenantId,
    productId: product.id,
    currency: 'EUR',
    unitAmount: 1_000,
    type: 'recurring',
    interval: 'month',
    intervalCount: 1,
    description: null,
    lookupKey: `migration-source-${suffix}`,
    active: true,
  });
  const targetPrice = await storage.canonicalPrices.create({
    tenantId,
    productId: product.id,
    currency: 'EUR',
    unitAmount: 1_500,
    type: 'recurring',
    interval: 'month',
    intervalCount: 1,
    description: null,
    lookupKey: `migration-target-${suffix}`,
    active: true,
  });
  const subscription = await storage.subscriptions.create({
    tenantId,
    customerId: customer.id,
    name: `migration-${suffix}`,
    provider: null,
    providerSubscriptionId: null,
    status: 'active',
    priceId: null,
    quantity: 1,
    canonicalPriceId: sourcePrice.id,
    canonicalProductId: product.id,
    acceptedCurrency: 'EUR',
    acceptedUnitAmount: 1_000,
    acceptedInterval: 'month',
    acceptedIntervalCount: 1,
    acceptedQuantity: 1,
    collectionResponsibility: 'provider',
    creationSource: 'test',
    trialEndsAt: null,
    endsAt: null,
    currentPeriodStart: STORAGE_TIME,
    currentPeriodEnd: new Date('2026-09-25T10:00:00.000Z'),
  });
  const binding = await storage.subscriptionProviderBindings.create({
    tenantId,
    subscriptionId: subscription.id,
    provider: 'provider-neutral-test',
    providerSubscriptionId: `provider-subscription-${suffix}`,
    providerSyncedAt: STORAGE_TIME,
  });
  return {
    subscriptionId: subscription.id,
    sourcePriceId: sourcePrice.id,
    targetPriceId: targetPrice.id,
    productId: product.id,
    providerBindingId: binding.id,
  };
}

export function migrationInput(
  dependencies: MigrationDependencies,
  overrides: Partial<NewSubscriptionPriceMigration> = {},
): NewSubscriptionPriceMigration {
  const base = {
    tenantId: 'migration-tenant',
    subscriptionId: dependencies.subscriptionId,
    primaryItemId: 'item-current',
    sourcePriceId: dependencies.sourcePriceId,
    targetPriceId: dependencies.targetPriceId,
    sourcePrice: {
      id: dependencies.sourcePriceId,
      productId: dependencies.productId,
      amount: 1_000,
      currency: 'EUR',
      interval: 'month',
      intervalCount: 1,
    },
    targetPrice: {
      id: dependencies.targetPriceId,
      productId: dependencies.productId,
      amount: 1_500,
      currency: 'EUR',
      interval: 'month',
      intervalCount: 1,
    },
    currentItems: [{ id: 'item-current', priceId: dependencies.sourcePriceId, quantity: 1 }],
    proposedItems: [{ id: 'item-current', priceId: dependencies.targetPriceId, quantity: 2 }],
    effectiveTiming: 'immediate' as const,
    effectiveAt: null,
    prorationPolicy: 'prorateImmediately' as const,
    paymentFailurePolicy: 'preventChange' as const,
    immediateAdjustment: { direction: 'charge' as const, amount: 500, currency: 'EUR' },
    nextRenewal: {
      amount: 3_000,
      currency: 'EUR',
      date: new Date('2026-09-25T10:00:00.000Z'),
    },
    currentRenewalDate: new Date('2026-09-25T10:00:00.000Z'),
    warnings: [],
    providerLimitations: [],
    previewToken: `preview-${dependencies.subscriptionId}`,
    requestHash: `hash-${dependencies.subscriptionId}`,
    calculatedAt: STORAGE_TIME,
    expiresAt: new Date('2026-08-25T10:30:00.000Z'),
    providerBindingId: dependencies.providerBindingId,
    status: 'previewed' as const,
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
  return { ...base, ...overrides } as NewSubscriptionPriceMigration;
}

export async function createScheduled(
  repository: SubscriptionPriceMigrationRepository,
  dependencies: MigrationDependencies,
  effectiveAt: Date,
): Promise<Extract<SubscriptionPriceMigration, { effectiveTiming: 'scheduled' }>> {
  const preview = await repository.create(
    migrationInput(dependencies, {
      effectiveTiming: 'scheduled',
      effectiveAt,
    }),
  );
  const scheduled = await repository.compareAndSwapState({
    id: preview.id,
    tenantId: preview.tenantId,
    expectedStatus: 'previewed',
    expectedExecutionToken: null,
    nextStatus: 'scheduled',
    executionToken: null,
    attemptCount: 0,
    failureCode: null,
    failureMessage: null,
    scheduledAt: STORAGE_TIME,
    executionStartedAt: null,
    appliedAt: null,
    failedAt: null,
    reconciliationRequiredAt: null,
    cancelledAt: null,
    updatedAt: STORAGE_TIME,
  });
  if (scheduled?.effectiveTiming !== 'scheduled') {
    throw new Error('Expected scheduled migration');
  }
  return scheduled;
}
