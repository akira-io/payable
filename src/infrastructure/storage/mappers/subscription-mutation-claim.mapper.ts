import {
  rehydrateSubscriptionMutationIntentBlob,
  type SubscriptionMutationClaim,
  type SubscriptionMutationOperation,
} from '../../../domain/contracts/subscription-mutation-claim-repository.contract';

export interface StoredSubscriptionMutationClaimRow {
  claimReference: string;
  tenantKey: string;
  subscriptionId: string;
  ownerToken: string;
  operation: string;
  correlationId: string;
  intent: string | null;
  status: string;
  resolutionOutcome: string | null;
  resolutionEvidenceReference: string | null;
  resolvedAt: Date | null;
  observationOutcome: string | null;
  observationEvidenceReference: string | null;
  observedAt: Date | null;
  claimedAt: Date;
}

const OPERATIONS: readonly SubscriptionMutationOperation[] = [
  'subscription_price_migration',
  'subscription_swap',
  'subscription_quantity_update',
  'subscription_cancel',
  'subscription_cancel_now',
  'subscription_cancel_scheduled_change',
  'subscription_pause',
  'subscription_pause_payment_collection',
  'subscription_resume',
  'subscription_resume_paused',
  'subscription_resume_payment_collection',
  'subscription_change_apply',
];

export function subscriptionMutationClaimToEntity(
  row: StoredSubscriptionMutationClaimRow,
): SubscriptionMutationClaim {
  if (!isOperation(row.operation)) invalid('operation');
  if (row.status !== 'active' && row.status !== 'resolved') invalid('status');
  if (
    row.resolutionOutcome !== null &&
    row.resolutionOutcome !== 'applied' &&
    row.resolutionOutcome !== 'not_applied'
  ) {
    invalid('resolution_outcome');
  }
  if (row.observationOutcome !== null && row.observationOutcome !== 'unknown') {
    invalid('observation_outcome');
  }
  const resolved = row.status === 'resolved';
  if (
    resolved !==
    (row.resolutionOutcome !== null &&
      row.resolutionEvidenceReference !== null &&
      row.resolvedAt !== null)
  ) {
    invalid('resolution');
  }
  if (
    (row.observationOutcome === null) !==
    (row.observationEvidenceReference === null && row.observedAt === null)
  ) {
    invalid('observation');
  }
  return {
    claimReference: nonEmpty(row.claimReference, 'claim_reference'),
    tenantId: row.tenantKey === '' ? null : row.tenantKey,
    subscriptionId: nonEmpty(row.subscriptionId, 'subscription_id'),
    ownerToken: nonEmpty(row.ownerToken, 'owner_token'),
    operation: row.operation,
    correlationId: nonEmpty(row.correlationId, 'correlation_id'),
    intent: row.intent === null ? null : rehydrateSubscriptionMutationIntentBlob(row.intent),
    status: row.status,
    resolutionOutcome: row.resolutionOutcome,
    resolutionEvidenceReference: row.resolutionEvidenceReference,
    resolvedAt: row.resolvedAt,
    observationOutcome: row.observationOutcome,
    observationEvidenceReference: row.observationEvidenceReference,
    observedAt: row.observedAt,
    claimedAt: validDate(row.claimedAt, 'claimed_at'),
  };
}

function isOperation(value: string): value is SubscriptionMutationOperation {
  return OPERATIONS.some((operation) => operation === value);
}

function nonEmpty(value: string, label: string): string {
  if (value.length === 0) invalid(label);
  return value;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) invalid(label);
  return value;
}

function invalid(label: string): never {
  throw new Error(`Invalid subscription mutation claim: ${label}`);
}
