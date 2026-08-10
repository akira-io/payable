import type { CollectionPage } from '../../domain/dtos/collection-page.dto';
import type { Subscription } from '../../domain/entities/subscription.entity';
import { PayableError } from '../../domain/errors/payable-error';
import type { SubscriptionStatus } from '../../domain/value-objects/subscription-status';
import {
  decodeCollectionCursor,
  encodeCollectionCursor,
} from '../services/collections/collection-cursor';
import { normalizeCollectionLimit } from '../services/collections/normalize-collection-query';
import type { LocalDependencies } from './local-dependencies';

export interface ListCanonicalSubscriptionsInput {
  limit?: number;
  cursor?: string;
  id?: string;
  customerId?: string;
  status?: SubscriptionStatus;
  canonicalPriceId?: string;
  canonicalProductId?: string;
  name?: string;
  includeBindings?: boolean;
}

export interface SubscriptionBindingMetadata {
  id: string;
  provider: string;
  providerSubscriptionId: string;
  providerSyncedAt: Date | null;
}

export type CanonicalSubscriptionPageItem = Subscription & {
  bindings?: SubscriptionBindingMetadata[];
};

export async function listCanonicalSubscriptions(
  dependencies: LocalDependencies,
  input: ListCanonicalSubscriptionsInput = {},
): Promise<CollectionPage<CanonicalSubscriptionPageItem>> {
  const storage = dependencies.storage;
  if (!storage) {
    throw new PayableError('Canonical subscription management requires a storage driver', {
      code: 'SUBSCRIPTION_STORAGE_REQUIRED',
    });
  }
  const tenantId = dependencies.tenantId ?? null;
  const filters = {
    id: input.id,
    customerId: input.customerId,
    status: input.status,
    canonicalPriceId: input.canonicalPriceId,
    canonicalProductId: input.canonicalProductId,
    name: input.name,
    includeBindings: input.includeBindings ?? false,
  };
  const context = { resource: 'subscriptions', tenantId, filters };
  const pageSubscriptions = storage.subscriptions.page;
  if (!pageSubscriptions) {
    throw new PayableError('The subscription repository does not support collection queries', {
      code: 'SUBSCRIPTION_PAGE_UNSUPPORTED',
    });
  }
  const page = await pageSubscriptions.call(
    storage.subscriptions,
    {
      limit: normalizeCollectionLimit(input.limit),
      before: input.cursor ? decodeCollectionCursor(input.cursor, context) : undefined,
      id: filters.id,
      customerId: filters.customerId,
      status: filters.status,
      canonicalPriceId: filters.canonicalPriceId,
      canonicalProductId: filters.canonicalProductId,
      name: filters.name,
    },
    tenantId,
  );
  const last = page.items.at(-1);
  const items = input.includeBindings
    ? await includeSubscriptionBindings(dependencies, page.items)
    : page.items;
  return {
    items,
    hasMore: page.hasMore,
    nextCursor:
      page.hasMore && last
        ? encodeCollectionCursor({ createdAt: last.createdAt, id: last.id }, context)
        : null,
  };
}

async function includeSubscriptionBindings(
  dependencies: LocalDependencies,
  subscriptions: Subscription[],
): Promise<CanonicalSubscriptionPageItem[]> {
  const storage = dependencies.storage;
  if (!storage) {
    throw new PayableError('Canonical subscription management requires a storage driver', {
      code: 'SUBSCRIPTION_STORAGE_REQUIRED',
    });
  }
  const repository = storage.subscriptionProviderBindings;
  const tenantId = dependencies.tenantId ?? null;
  const subscriptionIds = subscriptions.map(({ id }) => id);
  const bindings = repository.listBySubscriptionIds
    ? await repository.listBySubscriptionIds(subscriptionIds, tenantId)
    : (
        await Promise.all(
          subscriptionIds.map((id) => repository.listBySubscriptionId(id, tenantId)),
        )
      ).flat();
  const bySubscription = new Map<string, SubscriptionBindingMetadata[]>();
  for (const {
    id,
    subscriptionId,
    provider,
    providerSubscriptionId,
    providerSyncedAt,
  } of bindings) {
    const subscriptionBindings = bySubscription.get(subscriptionId) ?? [];
    subscriptionBindings.push({ id, provider, providerSubscriptionId, providerSyncedAt });
    bySubscription.set(subscriptionId, subscriptionBindings);
  }
  return subscriptions.map((subscription) => ({
    ...subscription,
    bindings: bySubscription.get(subscription.id) ?? [],
  }));
}
