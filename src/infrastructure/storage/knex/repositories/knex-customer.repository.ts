import type {
  CustomerListQuery,
  CustomerListResult,
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

  async list(query: CustomerListQuery, tenantId: string | null): Promise<CustomerListResult> {
    let customers = this.knex(this.table)
      .where('tenant_key', tenantId ?? '')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');
    if (query.id) {
      customers = customers.where('id', query.id);
    }
    if (query.billableType) {
      customers = customers.where('billable_type', query.billableType);
    }
    if (query.billableId) {
      customers = customers.where('billable_id', query.billableId);
    }
    if (query.email) {
      customers = customers.whereRaw("LOWER(email) LIKE ? ESCAPE '\\'", [
        searchPattern(query.email),
      ]);
    }
    if (query.name) {
      customers = customers.whereRaw("LOWER(name) LIKE ? ESCAPE '\\'", [searchPattern(query.name)]);
    }
    if (query.before) {
      const before = query.before;
      const createdAt = before.createdAt.toISOString();
      customers = customers.where((customer) =>
        customer
          .where('created_at', '<', createdAt)
          .orWhere((tie) => tie.where('created_at', createdAt).andWhere('id', '<', before.id)),
      );
    }
    const rows = (await customers.limit(query.limit + 1)) as Record<string, unknown>[];
    return {
      items: rows.slice(0, query.limit).map((row) => this.toEntity(row)),
      hasMore: rows.length > query.limit,
    };
  }

  async findByBillable(
    billableType: string,
    billableId: string,
    tenantId: string | null = null,
  ): Promise<Customer | null> {
    const row = await this.knex(this.table)
      .where('billable_type', billableType)
      .where('billable_id', billableId)
      .whereRaw("COALESCE(tenant_id, '') = ?", [tenantId ?? ''])
      .first();
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  protected toEntity(row: Record<string, unknown>): Customer {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
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
      tenant_key: data.tenantId === undefined ? undefined : (data.tenantId ?? ''),
      billable_type: data.billableType,
      billable_id: data.billableId,
      email: data.email,
      name: data.name,
      metadata: data.metadata === undefined ? undefined : fromJson(data.metadata),
    };
  }
}

function searchPattern(search: string): string {
  const escaped = search.toLocaleLowerCase('en-US').replace(/[\\%_]/gu, '\\$&');
  return `%${escaped}%`;
}
