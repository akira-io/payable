import type {
  CustomerRepository,
  NewCustomer,
} from '../../../../domain/contracts/customer-repository.contract';
import type { Customer } from '../../../../domain/entities/customer.entity';
import { KnexRepository } from '../knex-repository';
import { fromJson, toDate, toJson } from '../mappers';

export class KnexCustomerRepository
  extends KnexRepository<Customer, NewCustomer>
  implements CustomerRepository
{
  protected readonly table = 'payable_customers';

  findByBillable(
    billableType: string,
    billableId: string,
    tenantId: string | null = null,
  ): Promise<Customer | null> {
    return this.firstWhere({
      billable_type: billableType,
      billable_id: billableId,
      tenant_id: tenantId,
    });
  }

  findByProviderId(
    provider: string,
    providerCustomerId: string,
    tenantId?: string | null,
  ): Promise<Customer | null> {
    return this.firstWhere({
      provider,
      provider_customer_id: providerCustomerId,
      ...this.tenantClause(tenantId),
    });
  }

  protected toEntity(row: Record<string, unknown>): Customer {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      provider: row.provider as string,
      providerCustomerId: (row.provider_customer_id as string | null) ?? null,
      billableType: row.billable_type as string,
      billableId: row.billable_id as string,
      email: row.email as string,
      name: (row.name as string | null) ?? null,
      metadata: toJson(row.metadata),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected toRow(data: Partial<NewCustomer>): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      provider: data.provider,
      provider_customer_id: data.providerCustomerId,
      billable_type: data.billableType,
      billable_id: data.billableId,
      email: data.email,
      name: data.name,
      metadata: data.metadata === undefined ? undefined : fromJson(data.metadata),
    };
  }
}
