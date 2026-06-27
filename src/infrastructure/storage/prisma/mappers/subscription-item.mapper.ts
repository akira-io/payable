import type { NewSubscriptionItem } from '../../../../domain/contracts/subscription-item-repository.contract';
import type { SubscriptionItem } from '../../../../domain/entities/subscription-item.entity';
import type { PrismaSubscriptionItemRow } from '../prisma-client.types';

export function subscriptionItemToEntity(row: PrismaSubscriptionItemRow): SubscriptionItem {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    priceId: row.priceId,
    providerItemId: row.providerItemId ?? null,
    quantity: row.quantity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function subscriptionItemToRow(data: Partial<NewSubscriptionItem>): Record<string, unknown> {
  return {
    subscriptionId: data.subscriptionId,
    priceId: data.priceId,
    providerItemId: data.providerItemId,
    quantity: data.quantity,
  };
}
