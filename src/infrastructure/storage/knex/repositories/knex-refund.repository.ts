import type {
  NewRefund,
  RefundRepository,
} from '../../../../domain/contracts/refund-repository.contract';
import type { Refund } from '../../../../domain/entities/refund.entity';
import type { RefundStatus } from '../../../../domain/value-objects/refund-status';
import { KnexRepository } from '../knex-repository';
import { toDate } from '../mappers';

export class KnexRefundRepository
  extends KnexRepository<Refund, NewRefund>
  implements RefundRepository
{
  protected readonly table = 'payable_refunds';

  findByProviderId(provider: string, providerRefundId: string): Promise<Refund | null> {
    return this.firstWhere({ provider, provider_refund_id: providerRefundId });
  }

  listByPayment(paymentId: string): Promise<Refund[]> {
    return this.manyWhere({ payment_id: paymentId });
  }

  protected toEntity(row: Record<string, unknown>): Refund {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      paymentId: row.payment_id as string,
      provider: row.provider as string,
      providerRefundId: (row.provider_refund_id as string | null) ?? null,
      status: row.status as RefundStatus,
      currency: row.currency as string,
      amount: row.amount as number,
      reason: (row.reason as string | null) ?? null,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected toRow(data: Partial<NewRefund>): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      payment_id: data.paymentId,
      provider: data.provider,
      provider_refund_id: data.providerRefundId,
      status: data.status,
      currency: data.currency,
      amount: data.amount,
      reason: data.reason,
    };
  }
}
