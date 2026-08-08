import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewSubscriptionProviderBinding,
  SubscriptionProviderBindingRepository,
} from '../../../../domain/contracts/subscription-provider-binding-repository.contract';
import type { SubscriptionProviderBinding } from '../../../../domain/entities/subscription-provider-binding.entity';
import {
  subscriptionProviderBindingToEntity,
  subscriptionProviderBindingToRow,
} from '../mappers/subscription-provider-binding.mapper';
import type { PrismaClient } from '../prisma-client.types';

export class PrismaSubscriptionProviderBindingRepository
  implements SubscriptionProviderBindingRepository
{
  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async create(data: NewSubscriptionProviderBinding): Promise<SubscriptionProviderBinding> {
    const now = this.clock.now();
    const row = await this.client.payableSubscriptionProviderBinding.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        ...subscriptionProviderBindingToRow(data),
        createdAt: now,
        updatedAt: now,
      },
    });
    return subscriptionProviderBindingToEntity(row);
  }

  async findBySubscriptionAndProvider(
    subscriptionId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding | null> {
    const row = await this.client.payableSubscriptionProviderBinding.findFirst({
      where: { subscriptionId, provider, tenantKey: tenantId ?? '' },
    });
    return row ? subscriptionProviderBindingToEntity(row) : null;
  }

  async findByProviderId(
    provider: string,
    providerSubscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding | null> {
    const row = await this.client.payableSubscriptionProviderBinding.findFirst({
      where: { provider, providerSubscriptionId, tenantKey: tenantId ?? '' },
    });
    return row ? subscriptionProviderBindingToEntity(row) : null;
  }

  async listBySubscriptionId(
    subscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding[]> {
    const rows = await this.client.payableSubscriptionProviderBinding.findMany({
      where: { subscriptionId, tenantKey: tenantId ?? '' },
      orderBy: { provider: 'asc' },
    });
    return rows.map(subscriptionProviderBindingToEntity);
  }

  async listBySubscriptionIds(
    subscriptionIds: string[],
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding[]> {
    if (subscriptionIds.length === 0) return [];
    const rows = await this.client.payableSubscriptionProviderBinding.findMany({
      where: { subscriptionId: { in: subscriptionIds }, tenantKey: tenantId ?? '' },
      orderBy: [{ subscriptionId: 'asc' }, { provider: 'asc' }],
    });
    return rows.map(subscriptionProviderBindingToEntity);
  }

  async updateProviderSyncedAt(
    id: string,
    providerSyncedAt: Date,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding> {
    await this.client.payableSubscriptionProviderBinding.updateMany({
      where: { id, tenantKey: tenantId ?? '' },
      data: { providerSyncedAt, updatedAt: this.clock.now() },
    });
    const row = await this.client.payableSubscriptionProviderBinding.findFirst({
      where: { id, tenantKey: tenantId ?? '' },
    });
    if (!row) throw new Error(`payable_subscription_provider_bindings: row ${id} missing`);
    return subscriptionProviderBindingToEntity(row);
  }
}
