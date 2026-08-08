import type { TenantScoped, Timestamps } from './common';

export type CustomerProviderSyncStatus =
  | 'pending'
  | 'synchronized'
  | 'failed'
  | 'reconciliation_required';

export interface CustomerProviderSyncState extends TenantScoped, Timestamps {
  readonly id: string;
  readonly customerId: string;
  readonly provider: string;
  readonly status: CustomerProviderSyncStatus;
  readonly providerCustomerId: string | null;
  readonly attempts: number;
  readonly lastAttemptedAt: Date;
  readonly synchronizedAt: Date | null;
  readonly failureCode: string | null;
  readonly attemptOwnerId: string | null;
  readonly leaseExpiresAt: Date | null;
}
