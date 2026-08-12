import type {
  CanonicalInvoiceListQuery,
  CanonicalInvoiceListResult,
  CanonicalInvoiceRepository,
  NewCanonicalInvoice,
} from '../../../../domain/contracts/canonical-invoice-repository.contract';
import type { CanonicalInvoice } from '../../../../domain/entities/canonical-invoice.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import type { InvoiceStatus } from '../../../../domain/value-objects/invoice-status';
import { KnexRepository } from '../knex-repository';
import { toDate, toMinor } from '../mappers';

export class KnexCanonicalInvoiceRepository
  extends KnexRepository<CanonicalInvoice, NewCanonicalInvoice>
  implements CanonicalInvoiceRepository
{
  protected readonly table = 'payable_canonical_invoices';

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
    let rowsQuery = this.knex(this.table)
      .where({ tenant_key: tenantId ?? '' })
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');
    if (query.id) rowsQuery = rowsQuery.where({ id: query.id });
    if (query.customerId) rowsQuery = rowsQuery.where({ customer_id: query.customerId });
    if (query.subscriptionId) {
      rowsQuery = rowsQuery.where({ subscription_id: query.subscriptionId });
    }
    if (query.status) rowsQuery = rowsQuery.where({ status: query.status });
    if (query.number) rowsQuery = rowsQuery.where({ number: query.number });
    if (query.before) {
      const createdAt = query.before.createdAt.toISOString();
      rowsQuery = rowsQuery.where((row) =>
        row
          .where('created_at', '<', createdAt)
          .orWhere((tie) =>
            tie.where('created_at', createdAt).andWhere('id', '<', query.before?.id ?? ''),
          ),
      );
    }
    const rows = (await rowsQuery.limit(query.limit + 1)) as Record<string, unknown>[];
    return {
      items: rows.slice(0, query.limit).map((row) => this.toEntity(row)),
      hasMore: rows.length > query.limit,
    };
  }

  protected toEntity(row: Record<string, unknown>): CanonicalInvoice {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      customerId: row.customer_id as string,
      subscriptionId: (row.subscription_id as string | null) ?? null,
      status: row.status as InvoiceStatus,
      currency: CurrencyManager.normalize(row.currency as string),
      total: toMinor(row.total, 'total'),
      amountPaid: toMinor(row.amount_paid, 'amount_paid'),
      amountDue: toMinor(row.amount_due, 'amount_due'),
      number: (row.number as string | null) ?? null,
      hostedInvoiceUrl: (row.hosted_invoice_url as string | null) ?? null,
      invoicePdf: (row.invoice_pdf as string | null) ?? null,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected override createLookupTenantId(invoice: NewCanonicalInvoice): string | null {
    return invoice.tenantId;
  }

  protected toRow(invoice: Partial<NewCanonicalInvoice>): Record<string, unknown> {
    return {
      tenant_id: invoice.tenantId,
      tenant_key: invoice.tenantId === undefined ? undefined : (invoice.tenantId ?? ''),
      customer_id: invoice.customerId,
      subscription_id: invoice.subscriptionId,
      status: invoice.status,
      currency: invoice.currency,
      total: invoice.total,
      amount_paid: invoice.amountPaid,
      amount_due: invoice.amountDue,
      number: invoice.number,
      hosted_invoice_url: invoice.hostedInvoiceUrl,
      invoice_pdf: invoice.invoicePdf,
    };
  }
}
