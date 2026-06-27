import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewRefund,
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

  protected toEntity(row: PrismaRefundRow): Refund {
    return refundToEntity(row);
  }

  protected toRow(data: Partial<NewRefund>): Record<string, unknown> {
    return refundToRow(data);
  }
}
