import type { TenantScoped, Timestamps } from './common';

export interface SubscriptionProviderBinding extends TenantScoped, Timestamps {
  readonly id: string;
  readonly subscriptionId: string;
  readonly provider: string;
  readonly providerSubscriptionId: string;
  readonly providerSyncedAt: Date | null;
}
