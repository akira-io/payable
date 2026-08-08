import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  CustomerProviderSyncStateRepository,
  NewCustomerProviderSyncState,
} from '../../../../domain/contracts/customer-provider-sync-state-repository.contract';
import type { CustomerProviderSyncState } from '../../../../domain/entities/customer-provider-sync-state.entity';
import {
  customerProviderSyncStateToEntity,
  customerProviderSyncStateToRow,
} from '../mappers/customer-provider-sync-state.mapper';
import type { PrismaClient } from '../prisma-client.types';

export class PrismaCustomerProviderSyncStateRepository
  implements CustomerProviderSyncStateRepository
{
  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async upsert(data: NewCustomerProviderSyncState): Promise<CustomerProviderSyncState> {
    const now = this.clock.now();
    const values = customerProviderSyncStateToRow(data);
    const row = await this.client.payableCustomerProviderSyncState.upsert({
      where: {
        tenantKey_customerId_provider: {
          tenantKey: data.tenantId ?? '',
          customerId: data.customerId,
          provider: data.provider,
        },
      },
      create: {
        id: globalThis.crypto.randomUUID(),
        ...values,
        createdAt: now,
        updatedAt: now,
      },
      update: { ...values, updatedAt: now },
    });
    return customerProviderSyncStateToEntity(row);
  }

  async findByCustomerAndProvider(
    customerId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CustomerProviderSyncState | null> {
    const row = await this.client.payableCustomerProviderSyncState.findFirst({
      where: { customerId, provider, tenantId },
    });
    return row ? customerProviderSyncStateToEntity(row) : null;
  }
}
