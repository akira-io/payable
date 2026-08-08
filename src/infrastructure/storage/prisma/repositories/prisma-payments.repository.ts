import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewPayment,
  PaymentListQuery,
  PaymentListResult,
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
  private readonly supportsInsensitiveMode: boolean;

  constructor(client: PrismaClient, clock: Clock) {
    super(client.payablePayment, clock);
    const activeProvider = (client as unknown as { _activeProvider?: string })._activeProvider;
    this.supportsInsensitiveMode =
      activeProvider === 'postgresql' ||
      activeProvider === 'cockroachdb' ||
      activeProvider === 'mongodb';
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

  async page(query: PaymentListQuery, tenantId: string | null): Promise<PaymentListResult> {
    const filters: Record<string, unknown>[] = [
      { tenantKey: tenantId ?? '' },
      query.id ? { id: query.id } : {},
      query.customerId ? { customerId: query.customerId } : {},
      query.status ? { status: query.status } : {},
      query.currency ? { currency: query.currency } : {},
      query.reference ? { reference: this.textSearch(query.reference) } : {},
      query.description ? { description: this.textSearch(query.description) } : {},
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

  private textSearch(search: string): Record<string, unknown> {
    return this.supportsInsensitiveMode
      ? { contains: search, mode: 'insensitive' }
      : { contains: search };
  }
}
