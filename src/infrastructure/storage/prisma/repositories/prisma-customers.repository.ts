import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
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
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableCustomer, clock);
  }

  findByBillable(
    billableType: string,
    billableId: string,
    tenantId: string | null = null,
  ): Promise<Customer | null> {
    return this.firstWhere({ billableType, billableId, tenantId: tenantId ?? null });
  }

  findByProviderId(
    provider: string,
    providerCustomerId: string,
    tenantId?: string | null,
  ): Promise<Customer | null> {
    return this.firstWhere({
      provider,
      providerCustomerId,
      ...this.tenantClause(tenantId),
    });
  }

  protected toEntity(row: PrismaCustomerRow): Customer {
    return customerToEntity(row);
  }

  protected toRow(data: Partial<NewCustomer>): Record<string, unknown> {
    return customerToRow(data);
  }
}
