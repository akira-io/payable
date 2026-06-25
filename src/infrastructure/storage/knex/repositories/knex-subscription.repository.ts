import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewSubscription,
  SubscriptionRepository,
} from '../../../../domain/contracts/subscription-repository.contract';
import type { Subscription } from '../../../../domain/entities/subscription.entity';
import type { SubscriptionStatus } from '../../../../domain/value-objects/subscription-status';
import { KnexRepository } from '../knex-repository';
import { fromDate, toDate, toNullableDate } from '../mappers';

export class KnexSubscriptionRepository
  extends KnexRepository<Subscription, NewSubscription>
  implements SubscriptionRepository
{
  protected readonly table = 'payable_subscriptions';

  findByName(
    customerId: string,
    name: string,
    tenantId?: string | null,
  ): Promise<Subscription | null> {
    const where = { customer_id: customerId, name };
    return this.firstWhere(tenantId == null ? where : { ...where, tenant_id: tenantId });
  }

  findByProviderId(
    provider: string,
    providerSubscriptionId: string,
    tenantId?: string | null,
  ): Promise<Subscription | null> {
    const where = { provider, provider_subscription_id: providerSubscriptionId };
    return this.firstWhere(tenantId == null ? where : { ...where, tenant_id: tenantId });
  }

  listByCustomer(
    customerId: string,
    tenantId?: string | null,
    options?: ListOptions,
  ): Promise<Subscription[]> {
    return this.manyWhere({ customer_id: customerId, ...this.tenantClause(tenantId) }, options);
  }

  protected toEntity(row: Record<string, unknown>): Subscription {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      customerId: row.customer_id as string,
      name: row.name as string,
      provider: row.provider as string,
      providerSubscriptionId: (row.provider_subscription_id as string | null) ?? null,
      status: row.status as SubscriptionStatus,
      priceId: (row.price_id as string | null) ?? null,
      quantity: row.quantity as number,
      trialEndsAt: toNullableDate(row.trial_ends_at),
      endsAt: toNullableDate(row.ends_at),
      currentPeriodStart: toNullableDate(row.current_period_start),
      currentPeriodEnd: toNullableDate(row.current_period_end),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected toRow(data: Partial<NewSubscription>): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      customer_id: data.customerId,
      name: data.name,
      provider: data.provider,
      provider_subscription_id: data.providerSubscriptionId,
      status: data.status,
      price_id: data.priceId,
      quantity: data.quantity,
      trial_ends_at: fromDate(data.trialEndsAt),
      ends_at: fromDate(data.endsAt),
      current_period_start: fromDate(data.currentPeriodStart),
      current_period_end: fromDate(data.currentPeriodEnd),
    };
  }
}
