import type { NewSubscriptionPriceMigration } from '../../../domain/contracts';
import type { SubscriptionPriceMigration } from '../../../domain/entities';
import type { SubscriptionPriceMigrationStatus } from '../../../domain/value-objects';
import type { StoredSubscriptionPriceMigrationRow } from './subscription-price-migration.mapper';

const TERMINAL_STATUSES = new Set<SubscriptionPriceMigrationStatus>(['applied', 'cancelled']);
const CLAIMED_STATUSES = new Set<SubscriptionPriceMigrationStatus>([
  'executing',
  'pending_renewal',
  'applied',
  'reconciliation_required',
]);

export function activeSubscriptionId(
  status: SubscriptionPriceMigrationStatus,
  subscriptionId: string,
  reconciliationOutcome: string | null = null,
): string | null {
  return TERMINAL_STATUSES.has(status) ||
    (status === 'failed' && reconciliationOutcome === 'not_applied')
    ? null
    : subscriptionId;
}

export function assertExecutionOwnership(
  status: SubscriptionPriceMigrationStatus,
  executionToken: string | null,
): void {
  if (CLAIMED_STATUSES.has(status)) {
    if (typeof executionToken !== 'string' || executionToken.length === 0) {
      invalid('execution_token');
    }
    return;
  }
  if (executionToken !== null) invalid('execution_token');
}

export function assertPreviewLifecycle(data: NewSubscriptionPriceMigration): void {
  if (
    data.status !== 'previewed' ||
    data.attemptCount !== 0 ||
    data.executionToken !== null ||
    data.failureCode !== null ||
    data.failureMessage !== null ||
    data.scheduledAt !== null ||
    data.executionStartedAt !== null ||
    data.appliedAt !== null ||
    data.failedAt !== null ||
    data.reconciliationRequiredAt !== null ||
    data.reconciliationOutcome !== null ||
    data.reconciliationEvidenceReference !== null ||
    data.reconciliationResolvedAt !== null ||
    data.reconciliationObservationEvidenceReference !== null ||
    data.reconciliationObservedAt !== null ||
    data.cancelledAt !== null
  ) {
    invalid('preview_lifecycle');
  }
}

export function effectiveTiming(
  value: string,
  effectiveAt: Date | null,
): Pick<SubscriptionPriceMigration, 'effectiveTiming' | 'effectiveAt'> {
  if (value === 'scheduled' && effectiveAt) {
    return { effectiveTiming: value, effectiveAt: validDate(effectiveAt, 'effective_at') };
  }
  if ((value === 'immediate' || value === 'nextRenewal') && effectiveAt === null) {
    return { effectiveTiming: value, effectiveAt: null };
  }
  return invalid('effective_timing');
}

export function reconciliationOutcome(
  row: StoredSubscriptionPriceMigrationRow,
): SubscriptionPriceMigration['reconciliationOutcome'] {
  if (row.reconciliationOutcome === null) {
    if (row.reconciliationEvidenceReference !== null || row.reconciliationResolvedAt !== null) {
      invalid('reconciliation_resolution');
    }
    return null;
  }
  if (
    (row.reconciliationOutcome !== 'applied' && row.reconciliationOutcome !== 'not_applied') ||
    !row.reconciliationEvidenceReference ||
    !row.reconciliationResolvedAt
  ) {
    invalid('reconciliation_resolution');
  }
  return row.reconciliationOutcome;
}

function validDate(value: Date, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalid(label);
  return date;
}

function invalid(label: string): never {
  throw new Error(`Invalid subscription price migration: ${label}`);
}
