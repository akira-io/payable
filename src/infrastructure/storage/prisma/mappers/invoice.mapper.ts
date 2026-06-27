import type { NewInvoice } from '../../../../domain/contracts/invoice-repository.contract';
import type { Invoice } from '../../../../domain/entities/invoice.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import type { InvoiceStatus } from '../../../../domain/value-objects/invoice-status';
import type { PrismaInvoiceRow } from '../prisma-client.types';
import { fromMinor, toMinor } from './shared';

export function invoiceToEntity(row: PrismaInvoiceRow): Invoice {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    customerId: row.customerId,
    subscriptionId: row.subscriptionId ?? null,
    provider: row.provider,
    providerInvoiceId: row.providerInvoiceId ?? null,
    status: row.status as InvoiceStatus,
    currency: CurrencyManager.normalize(row.currency),
    total: toMinor(row.total, 'total'),
    amountPaid: toMinor(row.amountPaid, 'amount_paid'),
    amountDue: toMinor(row.amountDue, 'amount_due'),
    number: row.number ?? null,
    hostedInvoiceUrl: row.hostedInvoiceUrl ?? null,
    invoicePdf: row.invoicePdf ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function invoiceToRow(data: Partial<NewInvoice>): Record<string, unknown> {
  return {
    tenantId: data.tenantId,
    customerId: data.customerId,
    subscriptionId: data.subscriptionId,
    provider: data.provider,
    providerInvoiceId: data.providerInvoiceId,
    status: data.status,
    currency: data.currency,
    total: fromMinor(data.total),
    amountPaid: fromMinor(data.amountPaid),
    amountDue: fromMinor(data.amountDue),
    number: data.number,
    hostedInvoiceUrl: data.hostedInvoiceUrl,
    invoicePdf: data.invoicePdf,
  };
}
