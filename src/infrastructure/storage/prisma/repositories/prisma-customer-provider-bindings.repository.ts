import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  CustomerProviderBindingRepository,
  NewCustomerProviderBinding,
} from '../../../../domain/contracts/customer-provider-binding-repository.contract';
import type { CustomerProviderBinding } from '../../../../domain/entities/customer-provider-binding.entity';
import {
  customerProviderBindingToEntity,
  customerProviderBindingToRow,
} from '../mappers/customer-provider-binding.mapper';
import type { PrismaClient } from '../prisma-client.types';

export class PrismaCustomerProviderBindingRepository implements CustomerProviderBindingRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async create(data: NewCustomerProviderBinding): Promise<CustomerProviderBinding> {
    const now = this.clock.now();
    const row = await this.client.payableCustomerProviderBinding.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        ...customerProviderBindingToRow(data),
        createdAt: now,
        updatedAt: now,
      },
    });
    return customerProviderBindingToEntity(row);
  }

  async findByCustomerAndProvider(
    customerId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CustomerProviderBinding | null> {
    const row = await this.client.payableCustomerProviderBinding.findFirst({
      where: { customerId, provider, customer: { tenantId } },
    });
    return row ? customerProviderBindingToEntity(row) : null;
  }

  async findByProviderId(
    provider: string,
    providerCustomerId: string,
    tenantId: string | null,
  ): Promise<CustomerProviderBinding | null> {
    const row = await this.client.payableCustomerProviderBinding.findFirst({
      where: { provider, providerCustomerId, customer: { tenantId } },
    });
    return row ? customerProviderBindingToEntity(row) : null;
  }
}
