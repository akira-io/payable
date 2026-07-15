import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewPayment,
  PaymentRepository,
  RefundedAmountPatch,
} from '../../../../domain/contracts/payment-repository.contract';
import type { Payment } from '../../../../domain/entities/payment.entity';
import { paymentToEntity, paymentToRow } from '../mappers/payment.mapper';
import { fromMinor } from '../mappers/shared';
import type { PrismaClient, PrismaPaymentRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaPaymentRepository
  extends PrismaRepository<Payment, NewPayment, PrismaPaymentRow>
  implements PaymentRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payablePayment, clock);
  }

  findByProviderId(
    provider: string,
    providerPaymentId: string,
    tenantId?: string | null,
  ): Promise<Payment | null> {
    return this.firstWhere({
      provider,
      providerPaymentId,
      ...this.tenantClause(tenantId),
    });
  }

  listByCustomer(
    customerId: string,
    tenantId?: string | null,
    options?: ListOptions,
  ): Promise<Payment[]> {
    return this.manyWhere({ customerId, ...this.tenantClause(tenantId) }, options);
  }

  list(tenantId?: string | null, options?: ListOptions): Promise<Payment[]> {
    return this.manyWhere(this.tenantClause(tenantId), options);
  }

  async updateRefundedAmountIfUnchanged(
    id: string,
    expectedRefundedAmount: number,
    patch: RefundedAmountPatch,
    tenantId?: string | null,
  ): Promise<boolean> {
    const result = await this.delegate.updateMany({
      where: {
        ...this.scopedWhere(id, tenantId),
        refundedAmount: fromMinor(expectedRefundedAmount),
      },
      data: {
        refundedAmount: fromMinor(patch.refundedAmount),
        status: patch.status,
        updatedAt: this.clock.now(),
      },
    });
    return result.count > 0;
  }

  protected toEntity(row: PrismaPaymentRow): Payment {
    return paymentToEntity(row);
  }

  protected toRow(data: Partial<NewPayment>): Record<string, unknown> {
    return paymentToRow(data);
  }
}
