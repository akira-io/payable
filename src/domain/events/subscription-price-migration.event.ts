import type { SubscriptionPriceMigration } from '../entities/subscription-price-migration.entity';
import { DomainEvent } from './domain-event';

export type SubscriptionPriceMigrationEventStatus = Exclude<
  SubscriptionPriceMigration['status'],
  'previewed'
>;

export interface SubscriptionPriceMigrationEventPayload {
  migrationId: string;
  tenantId: string | null;
  subscriptionId: string;
  sourcePriceId: string;
  targetPriceId: string;
  status: SubscriptionPriceMigrationEventStatus;
  attemptCount: number;
  effectiveTiming: SubscriptionPriceMigration['effectiveTiming'];
  effectiveAt: string | null;
  failureCode: string | null;
  reconciliationOutcome: SubscriptionPriceMigration['reconciliationOutcome'];
  reconciliationEvidenceReference: string | null;
  reconciliationObservationOutcome: 'unknown' | null;
  reconciliationObservationEvidenceReference: string | null;
  correlationId: string;
}

export class SubscriptionPriceMigrationEvent extends DomainEvent<SubscriptionPriceMigrationEventPayload> {
  constructor(migration: SubscriptionPriceMigration, correlationId: string, occurredAt: Date) {
    if (migration.status === 'previewed') {
      throw new TypeError('A previewed migration has no lifecycle transition event');
    }
    super(
      `subscription.price_migration.${migration.status}`,
      {
        migrationId: migration.id,
        tenantId: migration.tenantId,
        subscriptionId: migration.subscriptionId,
        sourcePriceId: migration.sourcePriceId,
        targetPriceId: migration.targetPriceId,
        status: migration.status,
        attemptCount: migration.attemptCount,
        effectiveTiming: migration.effectiveTiming,
        effectiveAt: migration.effectiveAt?.toISOString() ?? null,
        failureCode: migration.failureCode,
        reconciliationOutcome: migration.reconciliationOutcome,
        reconciliationEvidenceReference: migration.reconciliationEvidenceReference,
        reconciliationObservationOutcome:
          migration.reconciliationObservationEvidenceReference === null ? null : 'unknown',
        reconciliationObservationEvidenceReference:
          migration.reconciliationObservationEvidenceReference,
        correlationId,
      },
      correlationId,
      occurredAt,
    );
  }
}
