import type {
  CanonicalInvoiceListQuery,
  CanonicalInvoiceListResult,
  CanonicalInvoiceRepository,
  NewCanonicalInvoice,
} from '../../../../domain/contracts/canonical-invoice-repository.contract';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { CanonicalInvoice } from '../../../../domain/entities/canonical-invoice.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import type { InvoiceStatus } from '../../../../domain/value-objects/invoice-status';
import { fromMinor, toMinor } from '../mappers/shared';
import type { PrismaClient } from '../prisma-client.types';
import type { PrismaCanonicalInvoiceRow } from '../prisma-invoice-row.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaCanonicalInvoiceRepository
  extends PrismaRepository<CanonicalInvoice, NewCanonicalInvoice, PrismaCanonicalInvoiceRow>
  implements CanonicalInvoiceRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableCanonicalInvoice, clock);
  }

  updateStatus(
    id: string,
    status: InvoiceStatus,
    tenantId: string | null,
  ): Promise<CanonicalInvoice> {
    return this.update(id, { status }, tenantId);
  }

  async list(
    query: CanonicalInvoiceListQuery,
    tenantId: string | null,
  ): Promise<CanonicalInvoiceListResult> {
    const filters: Record<string, unknown>[] = [
      { tenantKey: tenantId ?? '' },
      query.id ? { id: query.id } : {},
      query.customerId ? { customerId: query.customerId } : {},
      query.subscriptionId ? { subscriptionId: query.subscriptionId } : {},
      query.status ? { status: query.status } : {},
      query.number ? { number: query.number } : {},
    ];
    if (query.before)
      filters.push({
        OR: [
          { createdAt: { lt: query.before.createdAt } },
          { createdAt: query.before.createdAt, id: { lt: query.before.id } },
        ],
      });
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

  protected toEntity(row: PrismaCanonicalInvoiceRow): CanonicalInvoice {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      subscriptionId: row.subscriptionId,
      status: row.status as InvoiceStatus,
      currency: CurrencyManager.normalize(row.currency),
      total: toMinor(row.total, 'total'),
      amountPaid: toMinor(row.amountPaid, 'amount_paid'),
      amountDue: toMinor(row.amountDue, 'amount_due'),
      number: row.number,
      hostedInvoiceUrl: row.hostedInvoiceUrl,
      invoicePdf: row.invoicePdf,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  protected override scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    return { id, tenantKey: tenantId ?? '' };
  }

  protected toRow(invoice: Partial<NewCanonicalInvoice>): Record<string, unknown> {
    return {
      tenantId: invoice.tenantId,
      tenantKey: invoice.tenantId === undefined ? undefined : (invoice.tenantId ?? ''),
      customerId: invoice.customerId,
      subscriptionId: invoice.subscriptionId,
      status: invoice.status,
      currency: invoice.currency,
      total: fromMinor(invoice.total),
      amountPaid: fromMinor(invoice.amountPaid),
      amountDue: fromMinor(invoice.amountDue),
      number: invoice.number,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      invoicePdf: invoice.invoicePdf,
    };
  }
}
