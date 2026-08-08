import type { NewSubscriptionProviderBinding } from '../../../../domain/contracts/subscription-provider-binding-repository.contract';
import type { SubscriptionProviderBinding } from '../../../../domain/entities/subscription-provider-binding.entity';
import type { PrismaSubscriptionProviderBindingRow } from '../prisma-client.types';

export function subscriptionProviderBindingToEntity(
  row: PrismaSubscriptionProviderBindingRow,
): SubscriptionProviderBinding {
  return {
    id: row.id,
    tenantId: row.tenantId,
    subscriptionId: row.subscriptionId,
    provider: row.provider,
    providerSubscriptionId: row.providerSubscriptionId,
    providerSyncedAt: row.providerSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function subscriptionProviderBindingToRow(
  data: NewSubscriptionProviderBinding,
): Record<string, unknown> {
  return {
    tenantId: data.tenantId,
    tenantKey: data.tenantId ?? '',
    subscriptionId: data.subscriptionId,
    provider: data.provider,
    providerSubscriptionId: data.providerSubscriptionId,
    providerSyncedAt: data.providerSyncedAt,
  };
}
