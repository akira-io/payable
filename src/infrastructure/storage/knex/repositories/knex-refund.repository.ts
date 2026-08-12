import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewRefund,
  RefundListQuery,
  RefundListResult,
  RefundRepository,
} from '../../../../domain/contracts/refund-repository.contract';
import type { CollectionMethod } from '../../../../domain/entities/payment.entity';
import type { Refund } from '../../../../domain/entities/refund.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import type { RefundStatus } from '../../../../domain/value-objects/refund-status';
import { KnexRepository } from '../knex-repository';
import { fromDate, toDate, toMinor, toNullableDate } from '../mappers';

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

  async page(query: RefundListQuery, tenantId: string | null): Promise<RefundListResult> {
    let refunds = this.knex(this.table)
      .where('tenant_id', tenantId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');
    if (query.id) refunds = refunds.where('id', query.id);
    if (query.paymentId) refunds = refunds.where('payment_id', query.paymentId);
    if (query.before) {
      const createdAt = query.before.createdAt.toISOString();
      const beforeId = query.before.id;
      refunds = refunds.where((refund) =>
        refund
          .where('created_at', '<', createdAt)
          .orWhere((tie) => tie.where('created_at', createdAt).andWhere('id', '<', beforeId)),
      );
    }
    const rows = (await refunds.limit(query.limit + 1)) as Record<string, unknown>[];
    return {
      items: rows.slice(0, query.limit).map((row) => this.toEntity(row)),
      hasMore: rows.length > query.limit,
    };
  }

  protected toEntity(row: Record<string, unknown>): Refund {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      paymentId: row.payment_id as string,
      provider: (row.provider as string | null) ?? null,
      providerRefundId: (row.provider_refund_id as string | null) ?? null,
      status: row.status as RefundStatus,
      currency: CurrencyManager.normalize(row.currency as string),
      amount: toMinor(row.amount, 'amount'),
      reason: (row.reason as string | null) ?? null,
      collectionMethod: (row.collection_method as CollectionMethod | null) ?? null,
      occurredAt: toNullableDate(row.occurred_at),
      externalReference: (row.external_reference as string | null) ?? null,
      recordedBy: (row.recorded_by as string | null) ?? null,
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
      collection_method: data.collectionMethod,
      occurred_at: fromDate(data.occurredAt),
      external_reference: data.externalReference,
      recorded_by: data.recordedBy,
    };
  }
}
