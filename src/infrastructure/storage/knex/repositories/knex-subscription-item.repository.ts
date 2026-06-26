import type { Knex } from 'knex';
import type {
  NewSubscriptionItem,
  SubscriptionItemPatch,
  SubscriptionItemRepository,
} from '../../../../domain/contracts/subscription-item-repository.contract';
import type { SubscriptionItem } from '../../../../domain/entities/subscription-item.entity';
import { KnexRepository } from '../knex-repository';
import { toDate } from '../mappers';

const SUBSCRIPTION_ITEM_LIST_LIMIT = 100;

export class KnexSubscriptionItemRepository
  extends KnexRepository<SubscriptionItem, NewSubscriptionItem>
  implements SubscriptionItemRepository
{
  protected readonly table = 'payable_subscription_items';

  async listBySubscription(
    subscriptionId: string,
    tenantId?: string | null,
  ): Promise<SubscriptionItem[]> {
    const query = this.knex(this.table)
      .where({ subscription_id: subscriptionId })
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(SUBSCRIPTION_ITEM_LIST_LIMIT);
    if (tenantId !== undefined) {
      query.whereExists(this.subscriptionScope(subscriptionId, tenantId));
    }
    const rows = (await query) as Record<string, unknown>[];
    return rows.map((row) => this.toEntity(row));
  }

  async updatePrimary(
    subscriptionId: string,
    patch: SubscriptionItemPatch,
    tenantId?: string | null,
  ): Promise<void> {
    const query = this.knex(this.table)
      .where({ subscription_id: subscriptionId })
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc');
    if (tenantId !== undefined) {
      query.whereExists(this.subscriptionScope(subscriptionId, tenantId));
    }
    const first = await query.first();
    if (!first) {
      return;
    }
    const changes: Record<string, unknown> = { updated_at: this.clock.now().toISOString() };
    if (patch.priceId !== undefined) {
      changes.price_id = patch.priceId;
    }
    if (patch.quantity !== undefined) {
      changes.quantity = patch.quantity;
    }
    await this.knex(this.table).where({ id: first.id }).update(changes);
  }

  private subscriptionScope(subscriptionId: string, tenantId: string | null): Knex.QueryBuilder {
    const where =
      tenantId === null ? { id: subscriptionId } : { id: subscriptionId, tenant_id: tenantId };
    return this.knex('payable_subscriptions').select(this.knex.raw('1')).where(where);
  }

  protected toEntity(row: Record<string, unknown>): SubscriptionItem {
    return {
      id: row.id as string,
      subscriptionId: row.subscription_id as string,
      priceId: row.price_id as string,
      providerItemId: (row.provider_item_id as string | null) ?? null,
      quantity: row.quantity as number,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected toRow(data: Partial<NewSubscriptionItem>): Record<string, unknown> {
    return {
      subscription_id: data.subscriptionId,
      price_id: data.priceId,
      provider_item_id: data.providerItemId,
      quantity: data.quantity,
    };
  }
}
