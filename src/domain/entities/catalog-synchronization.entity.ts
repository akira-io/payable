import type { TenantScoped, Timestamps } from './common';

export type CatalogSynchronizationResourceType = 'product' | 'price';
export type CatalogSynchronizationOperation = 'create' | 'update' | 'archive' | 'reactivate';
export type CatalogSynchronizationStatus =
  | 'requested'
  | 'processing'
  | 'succeeded'
  | 'skipped'
  | 'failed'
  | 'retrying'
  | 'reconciled';
export type CatalogReconciliationState =
  | 'pending'
  | 'in_sync'
  | 'required'
  | 'missing_remote'
  | 'stale_local'
  | 'unsupported';

export interface CatalogSynchronization extends TenantScoped, Timestamps {
  readonly id: string;
  readonly provider: string;
  readonly resourceType: CatalogSynchronizationResourceType;
  readonly resourceId: string;
  readonly operation: CatalogSynchronizationOperation;
  readonly canonicalVersion: string;
  readonly idempotencyKey: string;
  readonly status: CatalogSynchronizationStatus;
  readonly reconciliationState: CatalogReconciliationState;
  readonly providerResourceId: string | null;
  readonly providerResourceVersion: string | null;
  readonly retryCount: number;
  readonly lastErrorCode: string | null;
  readonly lastAttemptedAt: Date | null;
  readonly lastSucceededAt: Date | null;
}
