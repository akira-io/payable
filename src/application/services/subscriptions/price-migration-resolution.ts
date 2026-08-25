import type { StorageDriver } from '../../../domain/contracts/storage-driver.contract';
import type { SubscriptionItem } from '../../../domain/entities/subscription-item.entity';
import type { SubscriptionProviderBinding } from '../../../domain/entities/subscription-provider-binding.entity';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';
import type { LocalDependencies } from '../../builders/local-dependencies';

export function requirePriceMigrationStorage(storage?: StorageDriver): StorageDriver {
  if (!storage?.canonicalPrices || !storage.priceProviderBindings) {
    throw resolutionError(
      'Subscription migration previews require canonical storage',
      'SUBSCRIPTION_MIGRATION_PREVIEW_STORAGE_REQUIRED',
    );
  }
  return storage;
}

export function selectPriceMigrationItem(
  items: SubscriptionItem[],
  subscriptionId: string,
  itemId?: string,
): SubscriptionItem {
  if (itemId === undefined && items.length !== 1) {
    throw resolutionError(
      'Subscription item selection is ambiguous',
      'SUBSCRIPTION_MIGRATION_STATE_CONFLICT',
      { subscriptionId, reason: 'item_ambiguous', itemCount: items.length },
    );
  }
  const selected = itemId === undefined ? items[0] : items.find(({ id }) => id === itemId);
  if (!selected) {
    throw resolutionError(
      'Subscription item was not found',
      'SUBSCRIPTION_MIGRATION_PREVIEW_STALE',
      { subscriptionId, reason: 'item_not_found', itemId: itemId ?? null },
    );
  }
  return selected;
}

export async function resolvePriceMigrationProviderBinding(
  storage: StorageDriver,
  subscriptionId: string,
  tenantId: string | null,
): Promise<SubscriptionProviderBinding> {
  const bindings = await storage.subscriptionProviderBindings.listBySubscriptionId(
    subscriptionId,
    tenantId,
  );
  if (bindings.length !== 1 || !bindings[0]) {
    throw resolutionError(
      'A unique provider binding is required',
      'SUBSCRIPTION_MIGRATION_STATE_CONFLICT',
      { subscriptionId },
    );
  }
  return bindings[0];
}

export async function resolveCompatibilityTargetPriceId(
  dependencies: LocalDependencies,
  input: { subscriptionId: string; providerPriceId?: string; itemId?: string },
): Promise<string> {
  const storage = requirePriceMigrationStorage(dependencies.storage);
  const tenantId = dependencies.tenantId ?? null;
  const items = await storage.subscriptionItems.listBySubscription(input.subscriptionId, tenantId);
  const selected = selectPriceMigrationItem(items, input.subscriptionId, input.itemId);
  if (input.providerPriceId === undefined) return selected.priceId;
  const binding = await resolvePriceMigrationProviderBinding(
    storage,
    input.subscriptionId,
    tenantId,
  );
  const providerPrice = await storage.priceProviderBindings?.findByProviderId(
    binding.provider,
    input.providerPriceId,
    tenantId,
  );
  if (!providerPrice) {
    throw resolutionError(
      'Target price has no provider binding',
      'SUBSCRIPTION_MIGRATION_TARGET_INELIGIBLE',
      { providerPriceId: input.providerPriceId, reason: 'provider_price_not_bound' },
    );
  }
  return providerPrice.priceId;
}

function resolutionError(
  message: string,
  code:
    | 'SUBSCRIPTION_MIGRATION_PREVIEW_STALE'
    | 'SUBSCRIPTION_MIGRATION_PREVIEW_STORAGE_REQUIRED'
    | 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT'
    | 'SUBSCRIPTION_MIGRATION_TARGET_INELIGIBLE',
  context?: Record<string, unknown>,
): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(message, code, { context });
}
