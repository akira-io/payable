import type { NewSubscriptionPriceMigration } from '../../../domain/contracts';
import type { SubscriptionPriceMigration } from '../../../domain/entities';
import { isSubscriptionPriceMigrationStatus } from '../../../domain/value-objects';
import { assertSubscriptionPriceMigrationCreateKeys } from './subscription-price-migration-create-keys';
import { canonicalSubscriptionPriceMigrationFailure } from './subscription-price-migration-failure.mapper';
import {
  decodeSubscriptionPriceMigrationJson,
  normalizeSubscriptionPriceMigrationJson,
} from './subscription-price-migration-json';
import {
  activeSubscriptionId,
  assertExecutionOwnership,
  assertPreviewLifecycle,
  effectiveTiming,
  reconciliationOutcome,
} from './subscription-price-migration-lifecycle.mapper';

export { activeSubscriptionId } from './subscription-price-migration-lifecycle.mapper';

export interface StoredSubscriptionPriceMigrationRow {
  id: string;
  tenantKey: string;
  subscriptionId: string;
  primaryItemId: string;
  activeSubscriptionId: string | null;
  sourcePriceId: string;
  targetPriceId: string;
  sourcePrice: string;
  targetPrice: string;
  currentItems: string;
  proposedItems: string;
  effectiveTiming: string;
  effectiveAt: Date | null;
  prorationPolicy: string;
  paymentFailurePolicy: string;
  immediateAdjustment: string;
  nextRenewal: string;
  currentRenewalDate: Date | null;
  warnings: string;
  providerLimitations: string;
  providerEvidence: string | null;
  previewToken: string;
  requestHash: string;
  calculatedAt: Date;
  expiresAt: Date;
  providerBindingId: string;
  status: string;
  attemptCount: number;
  executionToken: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  scheduledAt: Date | null;
  executionStartedAt: Date | null;
  appliedAt: Date | null;
  failedAt: Date | null;
  reconciliationRequiredAt: Date | null;
  reconciliationOutcome: string | null;
  reconciliationEvidenceReference: string | null;
  reconciliationResolvedAt: Date | null;
  reconciliationObservationEvidenceReference: string | null;
  reconciliationObservedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewSubscriptionPriceMigrationStorageValues = Omit<
  StoredSubscriptionPriceMigrationRow,
  'id' | 'createdAt' | 'updatedAt'
>;

const PRORATION_POLICIES = new Set([
  'prorateImmediately',
  'prorateAtNextRenewal',
  'chargeFullImmediately',
  'chargeFullAtNextRenewal',
  'none',
]);

export function subscriptionPriceMigrationToStorageValues(
  data: NewSubscriptionPriceMigration,
): NewSubscriptionPriceMigrationStorageValues {
  assertSubscriptionPriceMigrationCreateKeys(data as unknown as Record<string, unknown>);
  assertPreviewLifecycle(data);
  const json = normalizeSubscriptionPriceMigrationJson(data);
  if (json.sourcePrice.id !== data.sourcePriceId) invalid('source_price.id');
  if (json.targetPrice.id !== data.targetPriceId) invalid('target_price.id');
  const timing = effectiveTiming(data.effectiveTiming, data.effectiveAt);
  if (!PRORATION_POLICIES.has(data.prorationPolicy)) invalid('proration_policy');
  if (
    data.paymentFailurePolicy !== 'preventChange' &&
    data.paymentFailurePolicy !== 'applyChange'
  ) {
    invalid('payment_failure_policy');
  }
  return {
    tenantKey: data.tenantId ?? '',
    subscriptionId: nonEmpty(data.subscriptionId, 'subscription_id'),
    primaryItemId: nonEmpty(data.primaryItemId, 'primary_item_id'),
    activeSubscriptionId: data.subscriptionId,
    sourcePriceId: data.sourcePriceId,
    targetPriceId: data.targetPriceId,
    sourcePrice: JSON.stringify(json.sourcePrice),
    targetPrice: JSON.stringify(json.targetPrice),
    currentItems: JSON.stringify(json.currentItems),
    proposedItems: JSON.stringify(json.proposedItems),
    ...timing,
    prorationPolicy: data.prorationPolicy,
    paymentFailurePolicy: data.paymentFailurePolicy,
    immediateAdjustment: JSON.stringify(json.immediateAdjustment),
    nextRenewal: JSON.stringify(json.nextRenewal),
    currentRenewalDate:
      data.currentRenewalDate === null
        ? null
        : validDate(data.currentRenewalDate, 'current_renewal_date'),
    warnings: JSON.stringify(json.warnings),
    providerLimitations: JSON.stringify(json.providerLimitations),
    providerEvidence: null,
    previewToken: nonEmpty(data.previewToken, 'preview_token'),
    requestHash: nonEmpty(data.requestHash, 'request_hash'),
    calculatedAt: validDate(data.calculatedAt, 'calculated_at'),
    expiresAt: validDate(data.expiresAt, 'expires_at'),
    providerBindingId: nonEmpty(data.providerBindingId, 'provider_binding_id'),
    status: 'previewed',
    attemptCount: 0,
    executionToken: null,
    failureCode: null,
    failureMessage: null,
    scheduledAt: null,
    executionStartedAt: null,
    appliedAt: null,
    failedAt: null,
    reconciliationRequiredAt: null,
    reconciliationOutcome: null,
    reconciliationEvidenceReference: null,
    reconciliationResolvedAt: null,
    reconciliationObservationEvidenceReference: null,
    reconciliationObservedAt: null,
    cancelledAt: null,
  };
}

export function subscriptionPriceMigrationToEntity(
  row: StoredSubscriptionPriceMigrationRow,
): SubscriptionPriceMigration {
  if (!isSubscriptionPriceMigrationStatus(row.status)) invalid('status');
  if (!Number.isSafeInteger(row.attemptCount) || row.attemptCount < 0) invalid('attempt_count');
  assertExecutionOwnership(row.status, row.executionToken);
  const timing = effectiveTiming(row.effectiveTiming, row.effectiveAt);
  const expectedActiveId = activeSubscriptionId(
    row.status,
    row.subscriptionId,
    row.reconciliationOutcome,
  );
  if (row.activeSubscriptionId !== expectedActiveId) invalid('active_subscription_id');
  const failure = canonicalSubscriptionPriceMigrationFailure(
    row.status,
    row.failureCode,
    row.failureMessage,
  );
  if (
    (row.reconciliationObservationEvidenceReference === null) !==
    (row.reconciliationObservedAt === null)
  ) {
    invalid('reconciliation_observation');
  }
  const json = decodeSubscriptionPriceMigrationJson(row);
  if (json.sourcePrice.id !== row.sourcePriceId) invalid('source_price.id');
  if (json.targetPrice.id !== row.targetPriceId) invalid('target_price.id');
  return {
    id: row.id,
    tenantId: row.tenantKey === '' ? null : row.tenantKey,
    subscriptionId: row.subscriptionId,
    primaryItemId: nonEmpty(row.primaryItemId, 'primary_item_id'),
    sourcePriceId: row.sourcePriceId,
    targetPriceId: row.targetPriceId,
    ...json,
    ...timing,
    currentRenewalDate:
      row.currentRenewalDate === null
        ? null
        : validDate(row.currentRenewalDate, 'current_renewal_date'),
    prorationPolicy: row.prorationPolicy as SubscriptionPriceMigration['prorationPolicy'],
    paymentFailurePolicy:
      row.paymentFailurePolicy as SubscriptionPriceMigration['paymentFailurePolicy'],
    previewToken: row.previewToken,
    requestHash: row.requestHash,
    calculatedAt: validDate(row.calculatedAt, 'calculated_at'),
    expiresAt: validDate(row.expiresAt, 'expires_at'),
    providerBindingId: row.providerBindingId,
    status: row.status,
    attemptCount: row.attemptCount,
    executionToken: row.executionToken,
    failureCode: failure.code,
    failureMessage: failure.message,
    scheduledAt: row.scheduledAt,
    executionStartedAt: row.executionStartedAt,
    appliedAt: row.appliedAt,
    failedAt: row.failedAt,
    reconciliationRequiredAt: row.reconciliationRequiredAt,
    reconciliationOutcome: reconciliationOutcome(row),
    reconciliationEvidenceReference: row.reconciliationEvidenceReference,
    reconciliationResolvedAt: row.reconciliationResolvedAt,
    reconciliationObservationEvidenceReference: row.reconciliationObservationEvidenceReference,
    reconciliationObservedAt: row.reconciliationObservedAt,
    cancelledAt: row.cancelledAt,
    createdAt: validDate(row.createdAt, 'created_at'),
    updatedAt: validDate(row.updatedAt, 'updated_at'),
  } as SubscriptionPriceMigration;
}

function nonEmpty(value: string, label: string): string {
  if (value.length === 0) invalid(label);
  return value;
}

function validDate(value: Date, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalid(label);
  return date;
}

function invalid(label: string): never {
  throw new Error(`Invalid subscription price migration: ${label}`);
}
