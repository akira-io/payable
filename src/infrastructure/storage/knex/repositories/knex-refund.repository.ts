import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewRefund,
  RefundRepository,
} from '../../../../domain/contracts/refund-repository.contract';
import type { Refund } from '../../../../domain/entities/refund.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import type { RefundStatus } from '../../../../domain/value-objects/refund-status';
import { KnexRepository } from '../knex-repository';
import { toDate, toMinor } from '../mappers';

export class KnexRefundRepository
  extends KnexRepository<Refund, NewRefund>
  implements RefundRepository
{
  protected readonly table = 'payable_refunds';

  findByProviderId(
    provider: string,
    providerRefundId: string,
    tenantId?: string | null,
  ): Promise<Refund | null> {
    return this.firstWhere({
      provider,
      provider_refund_id: providerRefundId,
      ...this.tenantClause(tenantId),
    });
  }

  listByPayment(
    paymentId: string,
    tenantId?: string | null,
    options?: ListOptions,
  ): Promise<Refund[]> {
    return this.manyWhere({ payment_id: paymentId, ...this.tenantClause(tenantId) }, options);
  }

  protected toEntity(row: Record<string, unknown>): Refund {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      paymentId: row.payment_id as string,
      provider: row.provider as string,
      providerRefundId: (row.provider_refund_id as string | null) ?? null,
      status: row.status as RefundStatus,
      currency: CurrencyManager.normalize(row.currency as string),
      amount: toMinor(row.amount, 'amount'),
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
