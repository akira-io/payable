import type { Invoice } from '../entities/invoice.entity';
import type { ListOptions } from './list-options.contract';

export type NewInvoice = Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>;

export interface InvoiceRepository {
  create(data: NewInvoice): Promise<Invoice>;
  update(id: string, patch: Partial<NewInvoice>): Promise<Invoice>;
  findById(id: string): Promise<Invoice | null>;
  findByProviderId(provider: string, providerInvoiceId: string): Promise<Invoice | null>;
  listByCustomer(customerId: string, options?: ListOptions): Promise<Invoice[]>;
}
