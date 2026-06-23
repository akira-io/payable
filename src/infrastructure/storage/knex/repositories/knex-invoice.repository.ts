import type {
  InvoiceRepository,
  NewInvoice,
} from '../../../../domain/contracts/invoice-repository.contract';
import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type { Invoice } from '../../../../domain/entities/invoice.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import type { InvoiceStatus } from '../../../../domain/value-objects/invoice-status';
import { KnexRepository } from '../knex-repository';
import { toDate } from '../mappers';

export class KnexInvoiceRepository
  extends KnexRepository<Invoice, NewInvoice>
  implements InvoiceRepository
{
  protected readonly table = 'payable_invoices';

  findByProviderId(provider: string, providerInvoiceId: string): Promise<Invoice | null> {
    return this.firstWhere({ provider, provider_invoice_id: providerInvoiceId });
  }

  listByCustomer(customerId: string, options?: ListOptions): Promise<Invoice[]> {
    return this.manyWhere({ customer_id: customerId }, options);
  }

  protected toEntity(row: Record<string, unknown>): Invoice {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      customerId: row.customer_id as string,
      subscriptionId: (row.subscription_id as string | null) ?? null,
      provider: row.provider as string,
      providerInvoiceId: (row.provider_invoice_id as string | null) ?? null,
      status: row.status as InvoiceStatus,
      currency: CurrencyManager.normalize(row.currency as string),
      total: row.total as number,
      amountPaid: row.amount_paid as number,
      amountDue: row.amount_due as number,
      number: (row.number as string | null) ?? null,
      hostedInvoiceUrl: (row.hosted_invoice_url as string | null) ?? null,
      invoicePdf: (row.invoice_pdf as string | null) ?? null,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected toRow(data: Partial<NewInvoice>): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      customer_id: data.customerId,
      subscription_id: data.subscriptionId,
      provider: data.provider,
      provider_invoice_id: data.providerInvoiceId,
      status: data.status,
      currency: data.currency,
      total: data.total,
      amount_paid: data.amountPaid,
      amount_due: data.amountDue,
      number: data.number,
      hosted_invoice_url: data.hostedInvoiceUrl,
      invoice_pdf: data.invoicePdf,
    };
  }
}
