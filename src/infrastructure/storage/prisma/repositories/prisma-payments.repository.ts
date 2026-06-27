import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewPayment,
  PaymentRepository,
} from '../../../../domain/contracts/payment-repository.contract';
import type { Payment } from '../../../../domain/entities/payment.entity';
import { paymentToEntity, paymentToRow } from '../mappers/payment.mapper';
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

  protected toEntity(row: PrismaPaymentRow): Payment {
    return paymentToEntity(row);
  }

  protected toRow(data: Partial<NewPayment>): Record<string, unknown> {
    return paymentToRow(data);
  }
}
