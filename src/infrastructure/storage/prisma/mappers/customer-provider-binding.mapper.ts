import type { NewCustomerProviderBinding } from '../../../../domain/contracts/customer-provider-binding-repository.contract';
import type { CustomerProviderBinding } from '../../../../domain/entities/customer-provider-binding.entity';
import type { PrismaCustomerProviderBindingRow } from '../prisma-client.types';

export function customerProviderBindingToEntity(
  row: PrismaCustomerProviderBindingRow,
): CustomerProviderBinding {
  return {
    id: row.id,
    customerId: row.customerId,
    provider: row.provider,
    providerCustomerId: row.providerCustomerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function customerProviderBindingToRow(
  data: NewCustomerProviderBinding,
): Record<string, unknown> {
  return {
    customerId: data.customerId,
    provider: data.provider,
    providerCustomerId: data.providerCustomerId,
  };
}
