import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  CustomerListQuery,
  CustomerListResult,
  CustomerRepository,
  NewCustomer,
} from '../../../../domain/contracts/customer-repository.contract';
import type { Customer } from '../../../../domain/entities/customer.entity';
import { customerToEntity, customerToRow } from '../mappers/customer.mapper';
import type { PrismaClient, PrismaCustomerRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaCustomerRepository
  extends PrismaRepository<Customer, NewCustomer, PrismaCustomerRow>
  implements CustomerRepository
{
  private readonly supportsInsensitiveMode: boolean;

  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableCustomer, clock);
    const activeProvider = (client as unknown as { _activeProvider?: string })._activeProvider;
    this.supportsInsensitiveMode =
      activeProvider === 'postgresql' ||
      activeProvider === 'cockroachdb' ||
      activeProvider === 'mongodb';
  }

  async list(query: CustomerListQuery, tenantId: string | null): Promise<CustomerListResult> {
    const filters: Record<string, unknown>[] = [
      { tenantId },
      query.id ? { id: query.id } : {},
      query.billableType ? { billableType: query.billableType } : {},
      query.billableId ? { billableId: query.billableId } : {},
      query.email ? { email: this.textSearch(query.email) } : {},
      query.name ? { name: this.textSearch(query.name) } : {},
    ];
    if (query.before) {
      filters.push({
        OR: [
          { createdAt: { lt: query.before.createdAt } },
          { createdAt: query.before.createdAt, id: { lt: query.before.id } },
        ],
      });
    }
    const rows = await this.delegate.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return {
      items: rows.slice(0, query.limit).map((row) => this.toEntity(row)),
      hasMore: rows.length > query.limit,
    };
  }

  findByBillable(
    billableType: string,
    billableId: string,
    tenantId: string | null = null,
  ): Promise<Customer | null> {
    return this.firstWhere({ billableType, billableId, tenantId: tenantId ?? null });
  }

  protected toEntity(row: PrismaCustomerRow): Customer {
    return customerToEntity(row);
  }

  protected toRow(data: Partial<NewCustomer>): Record<string, unknown> {
    return customerToRow(data);
  }

  private textSearch(search: string): Record<string, unknown> {
    return this.supportsInsensitiveMode
      ? { contains: search, mode: 'insensitive' }
      : { contains: search };
  }
}
