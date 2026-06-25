import type {
  NewSubscriptionItem,
  SubscriptionItemPatch,
  SubscriptionItemRepository,
} from '../../../../domain/contracts/subscription-item-repository.contract';
import type { SubscriptionItem } from '../../../../domain/entities/subscription-item.entity';
import { KnexRepository } from '../knex-repository';
import { toDate } from '../mappers';

export class KnexSubscriptionItemRepository
  extends KnexRepository<SubscriptionItem, NewSubscriptionItem>
  implements SubscriptionItemRepository
{
  protected readonly table = 'payable_subscription_items';

  async listBySubscription(
    subscriptionId: string,
    tenantId?: string | null,
  ): Promise<SubscriptionItem[]> {
    if (tenantId !== undefined && !(await this.subscriptionInTenant(subscriptionId, tenantId))) {
      return [];
    }
    return this.manyWhere({ subscription_id: subscriptionId });
  }

  async updatePrimary(
    subscriptionId: string,
    patch: SubscriptionItemPatch,
    tenantId?: string | null,
  ): Promise<void> {
    if (tenantId !== undefined && !(await this.subscriptionInTenant(subscriptionId, tenantId))) {
      return;
    }
    const first = await this.knex(this.table)
      .where({ subscription_id: subscriptionId })
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .first();
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

  private async subscriptionInTenant(
    subscriptionId: string,
    tenantId: string | null,
  ): Promise<boolean> {
    const where =
      tenantId === null ? { id: subscriptionId } : { id: subscriptionId, tenant_id: tenantId };
    const row = await this.knex('payable_subscriptions').where(where).first();
    return Boolean(row);
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
