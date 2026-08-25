import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import {
  isSubscriptionChangeCapable,
  type SubscriptionChangeCapable,
} from '../../../domain/contracts/subscription-change-provider.contract';
import {
  isSubscriptionOperationCapabilitiesProvider,
  type SubscriptionOperationCapabilitiesProvider,
} from '../../../domain/contracts/subscription-operation-capabilities-provider.contract';
import type { ProviderSubscriptionChangeInput } from '../../../domain/dtos/subscription-change.dto';
import type { CanonicalPrice } from '../../../domain/entities/canonical-price.entity';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';
import { decodeSubscriptionPriceMigrationExecutionEvidence } from '../../../domain/internal/subscription-price-migration-execution-evidence';
import { isActiveSubscription } from '../../../domain/value-objects/subscription-status';
import type { LocalDependencies } from '../../builders/local-dependencies';
import {
  assertSubscriptionChangePolicies,
  assertSubscriptionChangeTerms,
} from '../provider-capabilities/assert-subscription-change-policies';
import { subscriptionChangeOperation } from './subscription-change-operation';

type MigrationProvider = PaymentProvider &
  SubscriptionChangeCapable &
  SubscriptionOperationCapabilitiesProvider;

export interface PreparedSubscriptionPriceMigrationExecution {
  migration: SubscriptionPriceMigration;
  subscription: Subscription;
  provider: MigrationProvider;
  providerKey: string;
  input: ProviderSubscriptionChangeInput;
}

export async function prepareSubscriptionPriceMigration(
  repositories: Repositories,
  migration: SubscriptionPriceMigration,
  dependencies: LocalDependencies,
): Promise<PreparedSubscriptionPriceMigrationExecution> {
  const tenantId = dependencies.tenantId ?? null;
  const subscription = await assertSubscriptionMigrationCanonicalSource(
    repositories,
    migration,
    tenantId,
  );
  const bindings = await repositories.subscriptionProviderBindings.listBySubscriptionId(
    migration.subscriptionId,
    tenantId,
  );
  const binding = bindings.find(({ id }) => id === migration.providerBindingId);
  if (!binding || bindings.length !== 1) throw staleSubscriptionMigration(migration.id);
  const evidenceBlob = await repositories.subscriptionPriceMigrations.findExecutionEvidenceById(
    migration.id,
    tenantId,
  );
  if (!evidenceBlob) throw staleSubscriptionMigration(migration.id);
  const evidence = decodeSubscriptionPriceMigrationExecutionEvidence(
    evidenceBlob,
    migration.currentItems,
    migration.proposedItems,
  );
  let provider: PaymentProvider | undefined;
  try {
    provider = dependencies.resolveProvider?.(evidence.provider);
  } catch {
    throw staleSubscriptionMigration(migration.id);
  }
  if (
    !provider ||
    !isSubscriptionChangeCapable(provider) ||
    !isSubscriptionOperationCapabilitiesProvider(provider)
  ) {
    throw new ProviderCapabilityNotSupportedError(evidence.provider, 'subscriptions.change.apply');
  }
  const operation = subscriptionChangeOperation(
    migration.currentItems.map(({ id, priceId }) => ({ itemId: id, priceId })),
    migration.proposedItems.map(({ id, priceId }) => ({ itemId: id, priceId })),
  );
  const capabilities = provider.subscriptionOperationCapabilities()[operation];
  assertSubscriptionChangePolicies(evidence.provider, capabilities, {
    ...(migration.effectiveTiming === 'scheduled'
      ? { effectiveTiming: 'scheduled' as const, effectiveAt: migration.effectiveAt }
      : { effectiveTiming: migration.effectiveTiming }),
    prorationPolicy: migration.prorationPolicy,
    paymentFailurePolicy: migration.paymentFailurePolicy,
  });
  assertSubscriptionChangeTerms(
    evidence.provider,
    capabilities,
    migration.sourcePrice,
    migration.targetPrice,
  );
  return {
    migration,
    subscription,
    provider,
    providerKey: evidence.provider,
    input: {
      providerSubscriptionId: evidence.providerSubscriptionId,
      currentItems: evidence.currentItems,
      proposedItems: evidence.proposedItems,
      ...(migration.effectiveTiming === 'scheduled'
        ? { effectiveTiming: 'scheduled', effectiveAt: migration.effectiveAt }
        : { effectiveTiming: migration.effectiveTiming }),
      prorationPolicy: migration.prorationPolicy,
      paymentFailurePolicy: migration.paymentFailurePolicy,
      calculatedAt: migration.calculatedAt,
      renewalDate: migration.currentRenewalDate,
    },
  };
}

export async function assertSubscriptionMigrationCanonicalSource(
  repositories: Repositories,
  migration: SubscriptionPriceMigration,
  tenantId: string | null,
  options: { allowRenewalDateAdvance?: boolean } = {},
): Promise<Subscription> {
  const subscription = await repositories.subscriptions.findById(
    migration.subscriptionId,
    tenantId,
  );
  const [customer, sourcePrice, targetPrice] = subscription
    ? await Promise.all([
        repositories.customers.findById(subscription.customerId, tenantId),
        repositories.canonicalPrices?.findById(migration.sourcePriceId, tenantId),
        repositories.canonicalPrices?.findById(migration.targetPriceId, tenantId),
      ])
    : [null, null, null];
  const items = (
    await repositories.subscriptionItems.listBySubscription(migration.subscriptionId, tenantId)
  ).toSorted((left, right) => left.id.localeCompare(right.id));
  const expected = [...migration.currentItems].toSorted((left, right) =>
    left.id.localeCompare(right.id),
  );
  const itemsChanged =
    items.length !== expected.length ||
    items.some((item, index) => {
      const snapshot = expected[index];
      return (
        !snapshot ||
        item.id !== snapshot.id ||
        item.priceId !== snapshot.priceId ||
        item.quantity !== snapshot.quantity
      );
    });
  const primaryItem = expected.find(({ id }) => id === migration.primaryItemId);
  const migratedItem = approvedMigratedCurrentItem(migration);
  const sourceIsPrimary = migratedItem?.id === migration.primaryItemId;
  const sourceChanged =
    !subscription ||
    !customer ||
    !isActiveSubscription(subscription.status) ||
    !sourcePrice ||
    !renewalDateIsCanonical(
      subscription?.currentPeriodEnd ?? null,
      migration.currentRenewalDate,
      options.allowRenewalDateAdvance ?? false,
    ) ||
    !samePriceSnapshot(sourcePrice, migration.sourcePrice) ||
    !migratedItem ||
    !primaryItem ||
    subscription.canonicalPriceId !== primaryItem.priceId ||
    subscription.acceptedQuantity !== primaryItem.quantity ||
    (sourceIsPrimary &&
      (subscription.priceId !== migration.sourcePriceId ||
        subscription.canonicalProductId !== migration.sourcePrice.productId ||
        subscription.acceptedCurrency !== migration.sourcePrice.currency ||
        subscription.acceptedUnitAmount !== migration.sourcePrice.amount ||
        subscription.acceptedInterval !== migration.sourcePrice.interval ||
        subscription.acceptedIntervalCount !== migration.sourcePrice.intervalCount));
  const targetChanged =
    !targetPrice ||
    (targetPrice.id !== sourcePrice?.id && !targetPrice.active) ||
    targetPrice.type !== 'recurring' ||
    !samePriceSnapshot(targetPrice, migration.targetPrice);
  if (sourceChanged || targetChanged || itemsChanged) {
    throw staleSubscriptionMigration(migration.id);
  }
  return subscription as Subscription;
}

function renewalDateIsCanonical(
  current: Date | null,
  previewed: Date | null,
  allowAdvance: boolean,
): boolean {
  if (!allowAdvance) return sameDate(current, previewed);
  return current !== null && previewed !== null && current.getTime() >= previewed.getTime();
}

function approvedMigratedCurrentItem(
  migration: SubscriptionPriceMigration,
): SubscriptionPriceMigration['currentItems'][number] | null {
  const candidates = migration.currentItems.filter((current) => {
    const proposed = migration.proposedItems.find(({ id }) => id === current.id);
    return (
      current.priceId === migration.sourcePriceId &&
      proposed?.priceId === migration.targetPriceId &&
      (current.priceId !== proposed.priceId || current.quantity !== proposed.quantity)
    );
  });
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left === null ? right === null : right !== null && left.getTime() === right.getTime();
}

export function staleSubscriptionMigration(id: string): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(
    'Subscription migration preview is stale',
    'SUBSCRIPTION_MIGRATION_PREVIEW_STALE',
    { context: { migrationId: id } },
  );
}

function samePriceSnapshot(
  price: CanonicalPrice,
  snapshot: SubscriptionPriceMigration['sourcePrice'],
): boolean {
  return (
    price.id === snapshot.id &&
    price.productId === snapshot.productId &&
    price.unitAmount === snapshot.amount &&
    price.currency === snapshot.currency &&
    price.interval === snapshot.interval &&
    price.intervalCount === snapshot.intervalCount
  );
}
