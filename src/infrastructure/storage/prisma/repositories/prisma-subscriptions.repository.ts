import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewSubscription,
  SubscriptionRepository,
} from '../../../../domain/contracts/subscription-repository.contract';
import type { Subscription } from '../../../../domain/entities/subscription.entity';
import { subscriptionToEntity, subscriptionToRow } from '../mappers/subscription.mapper';
import type { PrismaClient, PrismaSubscriptionRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaSubscriptionRepository
  extends PrismaRepository<Subscription, NewSubscription, PrismaSubscriptionRow>
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

  protected toEntity(row: PrismaSubscriptionRow): Subscription {
    return subscriptionToEntity(row);
  }

  protected toRow(data: Partial<NewSubscription>): Record<string, unknown> {
    return subscriptionToRow(data);
  }
}
