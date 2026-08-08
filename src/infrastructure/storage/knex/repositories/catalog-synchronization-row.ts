import type {
  CatalogSynchronizationPatch,
  NewCatalogSynchronization,
} from '../../../../domain/contracts/catalog-synchronization-repository.contract';
import type {
  CatalogReconciliationState,
  CatalogSynchronization,
  CatalogSynchronizationOperation,
  CatalogSynchronizationResourceType,
  CatalogSynchronizationStatus,
} from '../../../../domain/entities/catalog-synchronization.entity';

export function toCatalogSynchronizationRow(
  synchronization: NewCatalogSynchronization,
): Record<string, unknown> {
  return {
    tenant_id: synchronization.tenantId,
    tenant_key: synchronization.tenantId ?? '',
    provider: synchronization.provider,
    resource_type: synchronization.resourceType,
    resource_id: synchronization.resourceId,
    operation: synchronization.operation,
    canonical_version: synchronization.canonicalVersion,
    idempotency_key: synchronization.idempotencyKey,
    status: synchronization.status,
    reconciliation_state: synchronization.reconciliationState,
    provider_resource_id: synchronization.providerResourceId,
    provider_resource_version: synchronization.providerResourceVersion,
    retry_count: synchronization.retryCount,
    last_error_code: synchronization.lastErrorCode,
    last_attempted_at: synchronization.lastAttemptedAt?.toISOString() ?? null,
    last_succeeded_at: synchronization.lastSucceededAt?.toISOString() ?? null,
    attempt_owner_id: synchronization.attemptOwnerId ?? null,
    lease_expires_at: synchronization.leaseExpiresAt?.toISOString() ?? null,
  };
}

export function toCatalogSynchronizationPatch(
  patch: CatalogSynchronizationPatch,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const mappings: Array<[keyof CatalogSynchronizationPatch, string]> = [
    ['operation', 'operation'],
    ['canonicalVersion', 'canonical_version'],
    ['idempotencyKey', 'idempotency_key'],
    ['status', 'status'],
    ['reconciliationState', 'reconciliation_state'],
    ['providerResourceId', 'provider_resource_id'],
    ['providerResourceVersion', 'provider_resource_version'],
    ['retryCount', 'retry_count'],
    ['lastErrorCode', 'last_error_code'],
    ['lastAttemptedAt', 'last_attempted_at'],
    ['lastSucceededAt', 'last_succeeded_at'],
    ['attemptOwnerId', 'attempt_owner_id'],
    ['leaseExpiresAt', 'lease_expires_at'],
  ];
  for (const [property, column] of mappings) {
    const value = patch[property];
    if (value !== undefined) row[column] = value instanceof Date ? value.toISOString() : value;
  }
  return row;
}

export function catalogSynchronizationFromRow(
  row: Record<string, unknown>,
): CatalogSynchronization {
  return {
    id: row.id as string,
    tenantId: (row.tenant_id as string | null) ?? null,
    provider: row.provider as string,
    resourceType: row.resource_type as CatalogSynchronizationResourceType,
    resourceId: row.resource_id as string,
    operation: row.operation as CatalogSynchronizationOperation,
    canonicalVersion: row.canonical_version as string,
    idempotencyKey: row.idempotency_key as string,
    status: row.status as CatalogSynchronizationStatus,
    reconciliationState: row.reconciliation_state as CatalogReconciliationState,
    providerResourceId: (row.provider_resource_id as string | null) ?? null,
    providerResourceVersion: (row.provider_resource_version as string | null) ?? null,
    retryCount: Number(row.retry_count),
    lastErrorCode: (row.last_error_code as string | null) ?? null,
    lastAttemptedAt: row.last_attempted_at
      ? new Date(row.last_attempted_at as string | Date)
      : null,
    lastSucceededAt: row.last_succeeded_at
      ? new Date(row.last_succeeded_at as string | Date)
      : null,
    attemptOwnerId: (row.attempt_owner_id as string | null) ?? null,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at as string | Date) : null,
    createdAt: new Date(row.created_at as string | Date),
    updatedAt: new Date(row.updated_at as string | Date),
  };
}
