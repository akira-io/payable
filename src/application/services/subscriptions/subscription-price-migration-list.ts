import type { SubscriptionPriceMigrationRepository } from '../../../domain/contracts/subscription-price-migration-repository.contract';
import type { CollectionPage } from '../../../domain/dtos/collection-page.dto';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import type { ListSubscriptionPriceMigrationsInput } from '../../builders/subscription-price-migration-resource.contract';
import { decodeCollectionCursor, encodeCollectionCursor } from '../collections/collection-cursor';
import { normalizeCollectionLimit } from '../collections/normalize-collection-query';

export async function listSubscriptionPriceMigrations(
  repository: SubscriptionPriceMigrationRepository,
  tenantId: string | null,
  input: ListSubscriptionPriceMigrationsInput,
): Promise<CollectionPage<SubscriptionPriceMigration>> {
  const limit = normalizeCollectionLimit(input.limit);
  const filters = { subscriptionId: input.subscriptionId, status: input.status };
  const context = { resource: 'subscription-price-migrations', tenantId, filters };
  const page = await repository.list(
    {
      limit,
      before: input.cursor ? decodeCollectionCursor(input.cursor, context) : undefined,
      ...filters,
    },
    tenantId,
  );
  const last = page.items.at(-1);
  return {
    items: page.items,
    hasMore: page.hasMore,
    nextCursor:
      page.hasMore && last
        ? encodeCollectionCursor({ createdAt: last.createdAt, id: last.id }, context)
        : null,
  };
}
