import type { CanonicalInvoice } from '../entities/canonical-invoice.entity';
import type { InvoiceStatus } from '../value-objects/invoice-status';
import type { ListCursor } from './list-options.contract';

export type NewCanonicalInvoice = Omit<CanonicalInvoice, 'id' | 'createdAt' | 'updatedAt'>;

export interface CanonicalInvoiceListQuery {
  limit: number;
  before?: ListCursor;
  id?: string;
  customerId?: string;
  subscriptionId?: string;
  status?: InvoiceStatus;
  number?: string;
}

export interface CanonicalInvoiceListResult {
  items: CanonicalInvoice[];
  hasMore: boolean;
}

export interface CanonicalInvoiceRepository {
  create(invoice: NewCanonicalInvoice): Promise<CanonicalInvoice>;
  updateStatus(
    id: string,
    status: InvoiceStatus,
    tenantId: string | null,
  ): Promise<CanonicalInvoice>;
  findById(id: string, tenantId: string | null): Promise<CanonicalInvoice | null>;
  list(
    query: CanonicalInvoiceListQuery,
    tenantId: string | null,
  ): Promise<CanonicalInvoiceListResult>;
}
