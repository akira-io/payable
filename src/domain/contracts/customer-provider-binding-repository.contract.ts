import type { CustomerProviderBinding } from '../entities/customer-provider-binding.entity';

export type NewCustomerProviderBinding = Omit<
  CustomerProviderBinding,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface CustomerProviderBindingRepository {
  create(data: NewCustomerProviderBinding): Promise<CustomerProviderBinding>;
  findByCustomerAndProvider(
    customerId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CustomerProviderBinding | null>;
  findByProviderId(
    provider: string,
    providerCustomerId: string,
    tenantId: string | null,
  ): Promise<CustomerProviderBinding | null>;
  listByCustomerIds?(
    customerIds: readonly string[],
    tenantId: string | null,
  ): Promise<CustomerProviderBinding[]>;
}
