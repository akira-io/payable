import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewPayment,
  PaymentRepository,
} from '../../../../domain/contracts/payment-repository.contract';
import type { Payment } from '../../../../domain/entities/payment.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import type { PaymentStatus } from '../../../../domain/value-objects/payment-status';
import { KnexRepository } from '../knex-repository';
import { toDate } from '../mappers';

export class KnexPaymentRepository
  extends KnexRepository<Payment, NewPayment>
  implements PaymentRepository
{
  protected readonly table = 'payable_payments';

  findByProviderId(provider: string, providerPaymentId: string): Promise<Payment | null> {
    return this.firstWhere({ provider, provider_payment_id: providerPaymentId });
  }

  listByCustomer(customerId: string, options?: ListOptions): Promise<Payment[]> {
    return this.manyWhere({ customer_id: customerId }, options);
  }

  protected toEntity(row: Record<string, unknown>): Payment {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      customerId: (row.customer_id as string | null) ?? null,
      provider: row.provider as string,
      providerPaymentId: (row.provider_payment_id as string | null) ?? null,
      status: row.status as PaymentStatus,
      currency: CurrencyManager.normalize(row.currency as string),
      amount: Number(row.amount),
      refundedAmount: Number(row.refunded_amount),
      reference: (row.reference as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected toRow(data: Partial<NewPayment>): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      customer_id: data.customerId,
      provider: data.provider,
      provider_payment_id: data.providerPaymentId,
      status: data.status,
      currency: data.currency,
      amount: data.amount,
      refunded_amount: data.refundedAmount,
      reference: data.reference,
      description: data.description,
    };
  }
}
