import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewSubscription,
  SubscriptionListQuery,
  SubscriptionListResult,
  SubscriptionPatch,
  SubscriptionRepository,
} from '../../../../domain/contracts/subscription-repository.contract';
import type { Subscription } from '../../../../domain/entities/subscription.entity';
import { subscriptionToEntity, subscriptionToRow } from '../mappers/subscription.mapper';
import type { PrismaClient, PrismaSubscriptionRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaSubscriptionRepository
  extends PrismaRepository<Subscription, NewSubscription, PrismaSubscriptionRow, SubscriptionPatch>
  implements SubscriptionRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableSubscription, clock);
  }

  findByName(
    customerId: string,
    name: string,
    tenantId?: string | null,
  ): Promise<Subscription | null> {
    return this.firstWhere({ customerId, name, ...this.tenantClause(tenantId) });
  }

  findByProviderId(
    provider: string,
    providerSubscriptionId: string,
    tenantId?: string | null,
  ): Promise<Subscription | null> {
    return this.firstWhere({
      provider,
      providerSubscriptionId,
      ...this.tenantClause(tenantId),
    });
  }

  listByCustomer(
    customerId: string,
    tenantId?: string | null,
    options?: ListOptions,
  ): Promise<Subscription[]> {
    return this.manyWhere({ customerId, ...this.tenantClause(tenantId) }, options);
  }

  list(tenantId?: string | null, options?: ListOptions): Promise<Subscription[]> {
    return this.manyWhere(this.tenantClause(tenantId), options);
  }

  async page(
    query: SubscriptionListQuery,
    tenantId: string | null,
  ): Promise<SubscriptionListResult> {
    const filters: Record<string, unknown>[] = [
      { tenantKey: tenantId ?? '' },
      query.id ? { id: query.id } : {},
      query.customerId ? { customerId: query.customerId } : {},
      query.status ? { status: query.status } : {},
      query.canonicalPriceId ? { canonicalPriceId: query.canonicalPriceId } : {},
      query.canonicalProductId ? { canonicalProductId: query.canonicalProductId } : {},
      query.name ? { name: query.name } : {},
    ];
    if (query.before) {
      filters.push({
        OR: [
          { createdAt: { lt: query.before.createdAt } },
          { createdAt: query.before.createdAt, id: { lt: query.before.id } },
        ],
      });
    }
    const rows = await this.delegate.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return {
      items: rows.slice(0, query.limit).map((row) => this.toEntity(row)),
      hasMore: rows.length > query.limit,
    };
  }

  protected toEntity(row: PrismaSubscriptionRow): Subscription {
    return subscriptionToEntity(row);
  }

  protected toRow(data: Partial<NewSubscription>): Record<string, unknown> {
    return subscriptionToRow(data);
  }

  protected override toUpdateRow(data: SubscriptionPatch): Record<string, unknown> {
    return subscriptionToRow(data);
  }
}
