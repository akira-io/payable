import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { SubscriptionPriceMigrationEvent } from '../../../domain/events/subscription-price-migration.event';

export async function recordSubscriptionPriceMigrationTransition(
  repositories: Repositories,
  before: SubscriptionPriceMigration,
  after: SubscriptionPriceMigration,
  correlationId: string,
  occurredAt: Date,
  kind: 'state' | 'observation' = 'state',
): Promise<void> {
  const event = new SubscriptionPriceMigrationEvent(after, correlationId, occurredAt);
  await repositories.auditLogs.create({
    tenantId: after.tenantId,
    correlationId,
    actorType: 'system',
    actorId: null,
    action: event.name,
    resourceType: 'subscription_price_migration',
    resourceId: after.id,
    before: lifecycleSnapshot(before, correlationId),
    after: lifecycleSnapshot(after, correlationId),
    metadata: null,
    ipAddress: null,
    userAgent: null,
  });
  await repositories.outboxEvents.create({
    tenantId: after.tenantId,
    correlationId,
    eventType: `${event.name}.v1`,
    eventVersion: event.version,
    payload: { ...event.payload },
    dedupeKey: `subscription-price-migration:${after.id}:${after.status}:${after.attemptCount}${kind === 'observation' ? ':observation' : ''}`,
  });
}

function lifecycleSnapshot(
  migration: SubscriptionPriceMigration,
  correlationId: string,
): Record<string, unknown> {
  return {
    status: migration.status,
    attemptCount: migration.attemptCount,
    failureCode: migration.failureCode,
    reconciliationOutcome: migration.reconciliationOutcome,
    reconciliationEvidenceReference: migration.reconciliationEvidenceReference,
    reconciliationObservationOutcome:
      migration.reconciliationObservationEvidenceReference === null ? null : 'unknown',
    reconciliationObservationEvidenceReference:
      migration.reconciliationObservationEvidenceReference,
    correlationId,
  };
}
