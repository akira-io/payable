import type { StorageDriver } from '../../../domain/contracts/storage-driver.contract';
import type { SubscriptionChangeCapable } from '../../../domain/contracts/subscription-change-provider.contract';
import { isSubscriptionOperationCapabilitiesProvider } from '../../../domain/contracts/subscription-operation-capabilities-provider.contract';
import type {
  SubscriptionChangeItem,
  SubscriptionChangeTiming,
} from '../../../domain/dtos/subscription-change.dto';
import type {
  SubscriptionPaymentFailurePolicy,
  SubscriptionProrationPolicy,
} from '../../../domain/dtos/subscription-operation-capabilities.dto';
import type { CanonicalPrice } from '../../../domain/entities/canonical-price.entity';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { SubscriptionItem } from '../../../domain/entities/subscription-item.entity';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';
import { assertSubscriptionQuantity } from '../../../domain/validation/subscription-quantity';
import { isActiveSubscription } from '../../../domain/value-objects/subscription-status';
import type { LocalDependencies } from '../../builders/local-dependencies';
import {
  assertSubscriptionChangePolicies,
  assertSubscriptionChangeTerms,
} from '../provider-capabilities/assert-subscription-change-policies';
import {
  requirePriceMigrationStorage,
  resolvePriceMigrationProviderBinding,
  selectPriceMigrationItem,
} from './price-migration-resolution';

export interface PriceMigrationEligibilityInput {
  subscriptionId: string;
  targetPriceId: string;
  itemId?: string;
  timing: SubscriptionChangeTiming;
  prorationPolicy: SubscriptionProrationPolicy;
  paymentFailurePolicy: SubscriptionPaymentFailurePolicy;
  quantity?: number;
}

export interface ResolvedPriceMigrationEligibility {
  subscription: Subscription;
  sourcePrice: CanonicalPrice;
  targetPrice: CanonicalPrice;
  currentItems: SubscriptionItem[];
  selectedItem: SubscriptionItem;
  primaryItem: SubscriptionItem;
  providerBinding: Awaited<ReturnType<typeof resolvePriceMigrationProviderBinding>>;
  provider: Pick<SubscriptionChangeCapable, 'previewSubscriptionChange'>;
  providerKey: string;
  providerCurrentItems: SubscriptionChangeItem[];
  providerProposedItems: SubscriptionChangeItem[];
}

export async function resolvePriceMigrationEligibility(
  dependencies: LocalDependencies,
  input: PriceMigrationEligibilityInput,
): Promise<ResolvedPriceMigrationEligibility> {
  const storage = requirePriceMigrationStorage(dependencies.storage);
  const tenantId = dependencies.tenantId ?? null;
  const subscription = await storage.subscriptions.findById(input.subscriptionId, tenantId);
  if (!subscription || !isActiveSubscription(subscription.status)) {
    throw migrationError('Subscription state does not permit a price migration', 'STATE_CONFLICT', {
      subscriptionId: input.subscriptionId,
    });
  }
  const customer = await storage.customers.findById(subscription.customerId, tenantId);
  if (!customer) {
    throw migrationError('Canonical subscription customer is stale', 'PREVIEW_STALE', {
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
    });
  }
  const currentItems = (
    await storage.subscriptionItems.listBySubscription(subscription.id, tenantId)
  ).toSorted((left, right) => left.id.localeCompare(right.id));
  const selectedItem = selectPriceMigrationItem(currentItems, subscription.id, input.itemId);
  const primaryItem = resolvePrimaryItem(subscription, currentItems);
  if (input.quantity !== undefined) assertSubscriptionQuantity(input.quantity);
  const sourcePrice = await storage.canonicalPrices?.findById(selectedItem.priceId, tenantId);
  if (!sourcePrice || sourceIsStale(subscription, selectedItem, primaryItem, sourcePrice)) {
    throw migrationError('Canonical subscription source price is stale', 'PREVIEW_STALE', {
      subscriptionId: subscription.id,
    });
  }
  const targetPrice = await storage.canonicalPrices?.findById(input.targetPriceId, tenantId);
  if (
    !targetPrice ||
    (targetPrice.id !== sourcePrice.id && !targetPrice.active) ||
    targetPrice.type !== 'recurring' ||
    (targetPrice.id === sourcePrice.id && input.quantity === undefined) ||
    targetPrice.productId !== sourcePrice.productId
  ) {
    throw migrationError(
      'Target price is not eligible for this subscription',
      'TARGET_INELIGIBLE',
      {
        targetPriceId: input.targetPriceId,
      },
    );
  }
  const providerBinding = await resolvePriceMigrationProviderBinding(
    storage,
    subscription.id,
    tenantId,
  );
  const providerKey = providerBinding.provider;
  const provider = dependencies.resolveProvider?.(providerBinding.provider);
  if (!provider || !isSubscriptionOperationCapabilitiesProvider(provider)) {
    throw new ProviderCapabilityNotSupportedError(
      providerBinding.provider,
      'subscriptions.change.preview',
    );
  }
  const previewProvider = provider as typeof provider & Partial<SubscriptionChangeCapable>;
  if (typeof previewProvider.previewSubscriptionChange !== 'function') {
    throw new ProviderCapabilityNotSupportedError(providerKey, 'subscriptions.change.preview');
  }
  const operation = targetPrice.id === sourcePrice.id ? 'changeQuantity' : 'changePrice';
  const capabilities = provider.subscriptionOperationCapabilities()[operation];
  if (!capabilities.preview) {
    throw new ProviderCapabilityNotSupportedError(providerKey, 'subscriptions.change.preview');
  }
  assertSubscriptionChangePolicies(providerKey, capabilities, {
    ...input.timing,
    prorationPolicy: input.prorationPolicy,
    paymentFailurePolicy: input.paymentFailurePolicy,
  });
  assertSubscriptionChangeTerms(providerKey, capabilities, sourcePrice, targetPrice);
  const providerItems = await resolveProviderItems(
    storage,
    currentItems,
    selectedItem,
    targetPrice,
    input.quantity,
    providerKey,
    tenantId,
  );
  return {
    subscription,
    sourcePrice,
    targetPrice,
    currentItems,
    selectedItem,
    primaryItem,
    providerBinding,
    provider: previewProvider as typeof provider &
      Pick<SubscriptionChangeCapable, 'previewSubscriptionChange'>,
    providerKey,
    ...providerItems,
  };
}

function sourceIsStale(
  subscription: Subscription,
  item: SubscriptionItem,
  primaryItem: SubscriptionItem,
  price: CanonicalPrice,
): boolean {
  if (price.type !== 'recurring' || !price.interval || !price.intervalCount) return true;
  if (subscription.canonicalPriceId !== item.priceId) return false;
  return (
    subscription.priceId !== price.id ||
    subscription.canonicalProductId !== price.productId ||
    subscription.acceptedCurrency !== price.currency ||
    subscription.acceptedUnitAmount !== price.unitAmount ||
    subscription.acceptedInterval !== price.interval ||
    subscription.acceptedIntervalCount !== price.intervalCount ||
    subscription.acceptedQuantity !== primaryItem.quantity
  );
}

function resolvePrimaryItem(
  subscription: Subscription,
  items: SubscriptionItem[],
): SubscriptionItem {
  const candidates = items.filter(
    (item) =>
      item.priceId === subscription.canonicalPriceId &&
      item.quantity === subscription.acceptedQuantity,
  );
  if (candidates.length !== 1) {
    throw migrationError('Canonical subscription primary item is ambiguous', 'PREVIEW_STALE', {
      subscriptionId: subscription.id,
    });
  }
  return candidates[0] as SubscriptionItem;
}

async function resolveProviderItems(
  storage: StorageDriver,
  items: SubscriptionItem[],
  selected: SubscriptionItem,
  target: CanonicalPrice,
  quantity: number | undefined,
  provider: string,
  tenantId: string | null,
): Promise<{
  providerCurrentItems: SubscriptionChangeItem[];
  providerProposedItems: SubscriptionChangeItem[];
}> {
  const current = await Promise.all(
    items.map(async (item) => {
      const binding = await storage.priceProviderBindings?.findByPriceAndProvider(
        item.priceId,
        provider,
        tenantId,
      );
      if (!binding) {
        throw migrationError('Current price provider binding is stale', 'PREVIEW_STALE', {
          priceId: item.priceId,
        });
      }
      return {
        itemId: item.id,
        providerItemId: item.providerItemId,
        priceId: binding.providerPriceId,
        quantity: item.quantity,
      };
    }),
  );
  const targetBinding = await storage.priceProviderBindings?.findByPriceAndProvider(
    target.id,
    provider,
    tenantId,
  );
  if (!targetBinding) {
    throw migrationError('Target price has no provider binding', 'TARGET_INELIGIBLE', {
      targetPriceId: target.id,
    });
  }
  return {
    providerCurrentItems: current,
    providerProposedItems: current.map((item) =>
      item.itemId === selected.id
        ? {
            ...item,
            priceId: targetBinding.providerPriceId,
            quantity: quantity ?? item.quantity,
          }
        : item,
    ),
  };
}

type ErrorSuffix = 'PREVIEW_STALE' | 'STATE_CONFLICT' | 'TARGET_INELIGIBLE';

function migrationError(
  message: string,
  suffix: ErrorSuffix,
  context?: Record<string, unknown>,
): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(message, `SUBSCRIPTION_MIGRATION_${suffix}`, {
    context,
  });
}
