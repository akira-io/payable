import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewRefund,
  RefundListQuery,
  RefundListResult,
  RefundRepository,
} from '../../../../domain/contracts/refund-repository.contract';
import type { Refund } from '../../../../domain/entities/refund.entity';
import { refundToEntity, refundToRow } from '../mappers/refund.mapper';
import type { PrismaClient, PrismaRefundRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaRefundRepository
  extends PrismaRepository<Refund, NewRefund, PrismaRefundRow>
  implements RefundRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableRefund, clock);
  }

  findByProviderId(
    provider: string,
    providerRefundId: string,
    tenantId?: string | null,
  ): Promise<Refund | null> {
    return this.firstWhere({
      provider,
      providerRefundId,
      ...this.tenantClause(tenantId),
    });
  }

  listByPayment(
    paymentId: string,
    tenantId?: string | null,
    options?: ListOptions,
  ): Promise<Refund[]> {
    return this.manyWhere({ paymentId, ...this.tenantClause(tenantId) }, options);
  }

  async page(query: RefundListQuery, tenantId: string | null): Promise<RefundListResult> {
    const filters: Record<string, unknown>[] = [
      { tenantId },
      query.id ? { id: query.id } : {},
      query.paymentId ? { paymentId: query.paymentId } : {},
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

  protected toEntity(row: PrismaRefundRow): Refund {
    return refundToEntity(row);
  }

  protected toRow(data: Partial<NewRefund>): Record<string, unknown> {
    return refundToRow(data);
  }
}
