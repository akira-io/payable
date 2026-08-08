import type { NewCatalogSynchronization } from '../../../../domain/contracts/catalog-synchronization-repository.contract';
import type {
  CatalogReconciliationState,
  CatalogSynchronization,
  CatalogSynchronizationOperation,
  CatalogSynchronizationResourceType,
  CatalogSynchronizationStatus,
} from '../../../../domain/entities/catalog-synchronization.entity';
import type { PrismaCatalogSynchronizationRow } from '../prisma-client.types';

export function catalogSynchronizationValues(
  synchronization: NewCatalogSynchronization,
): Record<string, unknown> {
  return {
    tenantId: synchronization.tenantId,
    tenantKey: synchronization.tenantId ?? '',
    provider: synchronization.provider,
    resourceType: synchronization.resourceType,
    resourceId: synchronization.resourceId,
    operation: synchronization.operation,
    canonicalVersion: synchronization.canonicalVersion,
    idempotencyKey: synchronization.idempotencyKey,
    status: synchronization.status,
    reconciliationState: synchronization.reconciliationState,
    providerResourceId: synchronization.providerResourceId,
    providerResourceVersion: synchronization.providerResourceVersion,
    retryCount: synchronization.retryCount,
    lastErrorCode: synchronization.lastErrorCode,
    lastAttemptedAt: synchronization.lastAttemptedAt,
    lastSucceededAt: synchronization.lastSucceededAt,
    attemptOwnerId: synchronization.attemptOwnerId ?? null,
    leaseExpiresAt: synchronization.leaseExpiresAt ?? null,
  };
}

export function catalogSynchronizationFromPrismaRow(
  row: PrismaCatalogSynchronizationRow,
): CatalogSynchronization {
  return {
    id: row.id,
    tenantId: row.tenantId,
    provider: row.provider,
    resourceType: row.resourceType as CatalogSynchronizationResourceType,
    resourceId: row.resourceId,
    operation: row.operation as CatalogSynchronizationOperation,
    canonicalVersion: row.canonicalVersion,
    idempotencyKey: row.idempotencyKey,
    status: row.status as CatalogSynchronizationStatus,
    reconciliationState: row.reconciliationState as CatalogReconciliationState,
    providerResourceId: row.providerResourceId,
    providerResourceVersion: row.providerResourceVersion,
    retryCount: row.retryCount,
    lastErrorCode: row.lastErrorCode,
    lastAttemptedAt: row.lastAttemptedAt,
    lastSucceededAt: row.lastSucceededAt,
    attemptOwnerId: row.attemptOwnerId,
    leaseExpiresAt: row.leaseExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
