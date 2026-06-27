import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewSubscriptionItem,
  SubscriptionItemPatch,
  SubscriptionItemRepository,
} from '../../../../domain/contracts/subscription-item-repository.contract';
import type { SubscriptionItem } from '../../../../domain/entities/subscription-item.entity';
import {
  subscriptionItemToEntity,
  subscriptionItemToRow,
} from '../mappers/subscription-item.mapper';
import type { PrismaClient, PrismaSubscriptionItemRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

const SUBSCRIPTION_ITEM_LIST_LIMIT = 100;

export class PrismaSubscriptionItemRepository
  extends PrismaRepository<SubscriptionItem, NewSubscriptionItem, PrismaSubscriptionItemRow>
  implements SubscriptionItemRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableSubscriptionItem, clock);
  }

  async listBySubscription(
    subscriptionId: string,
    tenantId?: string | null,
  ): Promise<SubscriptionItem[]> {
    const rows = await this.delegate.findMany({
      where: this.scope(subscriptionId, tenantId),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SUBSCRIPTION_ITEM_LIST_LIMIT,
    });
    return rows.map((row) => subscriptionItemToEntity(row));
  }

  async updatePrimary(
    subscriptionId: string,
    patch: SubscriptionItemPatch,
    tenantId?: string | null,
  ): Promise<void> {
    const first = await this.delegate.findFirst({
      where: this.scope(subscriptionId, tenantId),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!first) {
      return;
    }
    const data: Record<string, unknown> = { updatedAt: this.clock.now() };
    if (patch.priceId !== undefined) {
      data.priceId = patch.priceId;
    }
    if (patch.quantity !== undefined) {
      data.quantity = patch.quantity;
    }
    await this.delegate.update({ where: { id: first.id }, data });
  }

  private scope(subscriptionId: string, tenantId?: string | null): Record<string, unknown> {
    if (tenantId === undefined || tenantId === null) {
      return { subscriptionId };
    }
    return { subscriptionId, subscription: { tenantId } };
  }

  protected toEntity(row: PrismaSubscriptionItemRow): SubscriptionItem {
    return subscriptionItemToEntity(row);
  }

  protected toRow(data: Partial<NewSubscriptionItem>): Record<string, unknown> {
    return subscriptionItemToRow(data);
  }
}
