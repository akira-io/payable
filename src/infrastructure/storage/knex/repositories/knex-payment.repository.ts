import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewPayment,
  PaymentListQuery,
  PaymentListResult,
  PaymentRepository,
  RefundedAmountPatch,
} from '../../../../domain/contracts/payment-repository.contract';
import type { CollectionMethod, Payment } from '../../../../domain/entities/payment.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import type { PaymentStatus } from '../../../../domain/value-objects/payment-status';
import { KnexRepository } from '../knex-repository';
import { fromDate, toDate, toMinor, toNullableDate } from '../mappers';

export class KnexPaymentRepository
  extends KnexRepository<Payment, NewPayment>
  implements PaymentRepository
{
  protected readonly table = 'payable_payments';

  findByProviderId(
    provider: string,
    providerPaymentId: string,
    tenantId?: string | null,
  ): Promise<Payment | null> {
    return this.firstWhere({
      provider,
      provider_payment_id: providerPaymentId,
      ...this.tenantClause(tenantId),
    });
  }

  listByCustomer(
    customerId: string,
    tenantId?: string | null,
    options?: ListOptions,
  ): Promise<Payment[]> {
    return this.manyWhere({ customer_id: customerId, ...this.tenantClause(tenantId) }, options);
  }

  list(tenantId?: string | null, options?: ListOptions): Promise<Payment[]> {
    return this.manyWhere(this.tenantClause(tenantId), options);
  }

  async page(query: PaymentListQuery, tenantId: string | null): Promise<PaymentListResult> {
    let payments = this.knex(this.table)
      .where('tenant_key', tenantId ?? '')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');
    if (query.id) payments = payments.where('id', query.id);
    if (query.customerId) payments = payments.where('customer_id', query.customerId);
    if (query.status) payments = payments.where('status', query.status);
    if (query.currency) payments = payments.where('currency', query.currency);
    if (query.reference) {
      payments = payments.whereRaw("LOWER(reference) LIKE ? ESCAPE '\\'", [
        searchPattern(query.reference),
      ]);
    }
    if (query.description) {
      payments = payments.whereRaw("LOWER(description) LIKE ? ESCAPE '\\'", [
        searchPattern(query.description),
      ]);
    }
    if (query.before) {
      const before = query.before;
      const createdAt = before.createdAt.toISOString();
      payments = payments.where((payment) =>
        payment
          .where('created_at', '<', createdAt)
          .orWhere((tie) => tie.where('created_at', createdAt).andWhere('id', '<', before.id)),
      );
    }
    const rows = (await payments.limit(query.limit + 1)) as Record<string, unknown>[];
    return {
      items: rows.slice(0, query.limit).map((row) => this.toEntity(row)),
      hasMore: rows.length > query.limit,
    };
  }

  async updateRefundedAmountIfUnchanged(
    id: string,
    expectedRefundedAmount: number,
    patch: RefundedAmountPatch,
    tenantId?: string | null,
  ): Promise<boolean> {
    const count = await this.knex(this.table)
      .where(this.scopedWhere(id, tenantId))
      .where({ refunded_amount: expectedRefundedAmount })
      .update({
        refunded_amount: patch.refundedAmount,
        status: patch.status,
        updated_at: this.clock.now().toISOString(),
      });
    return count > 0;
  }

  protected toEntity(row: Record<string, unknown>): Payment {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      customerId: (row.customer_id as string | null) ?? null,
      provider: (row.provider as string | null) ?? null,
      providerPaymentId: (row.provider_payment_id as string | null) ?? null,
      status: row.status as PaymentStatus,
      currency: CurrencyManager.normalize(row.currency as string),
      amount: toMinor(row.amount, 'amount'),
      refundedAmount: toMinor(row.refunded_amount, 'refunded_amount'),
      reference: (row.reference as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      collectionMethod: (row.collection_method as CollectionMethod | null) ?? null,
      occurredAt: toNullableDate(row.occurred_at),
      externalReference: (row.external_reference as string | null) ?? null,
      recordedBy: (row.recorded_by as string | null) ?? null,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected toRow(data: Partial<NewPayment>): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      tenant_key: data.tenantId === undefined ? undefined : (data.tenantId ?? ''),
      customer_id: data.customerId,
      provider: data.provider,
      provider_payment_id: data.providerPaymentId,
      status: data.status,
      currency: data.currency,
      amount: data.amount,
      refunded_amount: data.refundedAmount,
      reference: data.reference,
      description: data.description,
      collection_method: data.collectionMethod,
      occurred_at: fromDate(data.occurredAt),
      external_reference: data.externalReference,
      recorded_by: data.recordedBy,
    };
  }
}

function searchPattern(search: string): string {
  const escaped = search.toLocaleLowerCase('en-US').replace(/[\\%_]/gu, '\\$&');
  return `%${escaped}%`;
}
