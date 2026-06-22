import type { Customer } from '../entities/customer.entity';

export type NewCustomer = Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>;

export interface CustomerRepository {
  create(data: NewCustomer): Promise<Customer>;
  update(id: string, patch: Partial<NewCustomer>): Promise<Customer>;
  findById(id: string): Promise<Customer | null>;
  findByBillable(
    billableType: string,
    billableId: string,
    tenantId?: string | null,
  ): Promise<Customer | null>;
  findByProviderId(provider: string, providerCustomerId: string): Promise<Customer | null>;
}
