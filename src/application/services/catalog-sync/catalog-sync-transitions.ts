import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { CatalogSynchronization } from '../../../domain/entities/catalog-synchronization.entity';

export async function recordCatalogSyncTransition(
  repositories: Repositories,
  synchronization: CatalogSynchronization,
  correlationId: string,
  context: { source?: 'manual' | 'webhook' } = {},
): Promise<void> {
  const transition = `catalog.synchronization.${synchronization.status}`;
  const snapshot = snapshotOf(synchronization, context);
  await repositories.auditLogs.create({
    tenantId: synchronization.tenantId,
    correlationId,
    actorType: 'system',
    actorId: synchronization.provider,
    action: transition,
    resourceType: synchronization.resourceType,
    resourceId: synchronization.resourceId,
    before: null,
    after: snapshot,
    metadata: {
      provider: synchronization.provider,
      providerResourceId: synchronization.providerResourceId,
      source: context.source,
    },
    ipAddress: null,
    userAgent: null,
  });
  await repositories.outboxEvents.create({
    tenantId: synchronization.tenantId,
    correlationId,
    eventType: `${transition}.v1`,
    eventVersion: 1,
    payload: snapshot,
    dedupeKey: [
      'catalog-sync',
      synchronization.id,
      synchronization.status,
      synchronization.canonicalVersion,
      synchronization.retryCount,
      synchronization.reconciliationState,
      synchronization.providerResourceId ?? 'none',
      synchronization.providerResourceVersion ?? 'none',
      synchronization.lastErrorCode ?? 'none',
      context.source ?? 'worker',
      correlationId,
    ].join(':'),
  });
}

function snapshotOf(
  synchronization: CatalogSynchronization,
  context: { source?: 'manual' | 'webhook' },
): Record<string, unknown> {
  return {
    synchronizationId: synchronization.id,
    tenantId: synchronization.tenantId,
    provider: synchronization.provider,
    resourceType: synchronization.resourceType,
    resourceId: synchronization.resourceId,
    operation: synchronization.operation,
    canonicalVersion: synchronization.canonicalVersion,
    status: synchronization.status,
    reconciliationState: synchronization.reconciliationState,
    providerResourceId: synchronization.providerResourceId,
    providerResourceVersion: synchronization.providerResourceVersion,
    retryCount: synchronization.retryCount,
    lastErrorCode: synchronization.lastErrorCode,
    source: context.source,
  };
}
