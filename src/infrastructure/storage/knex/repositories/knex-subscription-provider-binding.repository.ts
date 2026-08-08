import type {
  NewSubscriptionProviderBinding,
  SubscriptionProviderBindingRepository,
} from '../../../../domain/contracts/subscription-provider-binding-repository.contract';
import type { SubscriptionProviderBinding } from '../../../../domain/entities/subscription-provider-binding.entity';
import { KnexRepository } from '../knex-repository';
import { fromDate, toDate, toNullableDate } from '../mappers';

export class KnexSubscriptionProviderBindingRepository
  extends KnexRepository<SubscriptionProviderBinding, NewSubscriptionProviderBinding>
  implements SubscriptionProviderBindingRepository
{
  protected readonly table = 'payable_subscription_provider_bindings';

  findBySubscriptionAndProvider(
    subscriptionId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding | null> {
    return this.firstWhere({
      subscription_id: subscriptionId,
      provider,
      tenant_key: tenantId ?? '',
    });
  }

  findByProviderId(
    provider: string,
    providerSubscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding | null> {
    return this.firstWhere({
      provider,
      provider_subscription_id: providerSubscriptionId,
      tenant_key: tenantId ?? '',
    });
  }

  async listBySubscriptionId(
    subscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding[]> {
    return this.manyWhere({ subscription_id: subscriptionId, tenant_key: tenantId ?? '' });
  }

  updateProviderSyncedAt(
    id: string,
    providerSyncedAt: Date,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding> {
    return this.update(id, { providerSyncedAt }, tenantId);
  }

  protected toEntity(row: Record<string, unknown>): SubscriptionProviderBinding {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      subscriptionId: row.subscription_id as string,
      provider: row.provider as string,
      providerSubscriptionId: row.provider_subscription_id as string,
      providerSyncedAt: toNullableDate(row.provider_synced_at),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected toRow(data: Partial<NewSubscriptionProviderBinding>): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      tenant_key: data.tenantId ?? '',
      subscription_id: data.subscriptionId,
      provider: data.provider,
      provider_subscription_id: data.providerSubscriptionId,
      provider_synced_at: fromDate(data.providerSyncedAt),
    };
  }
}
