import type { Customer } from '../entities/customer.entity';
import type { ListCursor } from './list-options.contract';

export type NewCustomer = Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>;

export interface CustomerListQuery {
  limit: number;
  before?: ListCursor;
  id?: string;
  billableType?: string;
  billableId?: string;
  email?: string;
  name?: string;
}

export interface CustomerListResult {
  items: Customer[];
  hasMore: boolean;
}

export interface CustomerRepository {
  create(data: NewCustomer): Promise<Customer>;
  update(id: string, patch: Partial<NewCustomer>, tenantId?: string | null): Promise<Customer>;
  findById(id: string, tenantId?: string | null): Promise<Customer | null>;
  findByBillable(
    billableType: string,
    billableId: string,
    tenantId?: string | null,
  ): Promise<Customer | null>;
  list?(query: CustomerListQuery, tenantId: string | null): Promise<CustomerListResult>;
}
