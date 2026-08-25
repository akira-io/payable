import type { z } from 'zod';
import {
  type AuthorizationContext,
  isAuthorized,
} from '../../application/policies/authorization-context';
import type { SubscriptionPriceMigration } from '../../domain/entities/subscription-price-migration.entity';
import { PayableError } from '../../domain/errors/payable-error';
import type { Payable } from '../../payable';
import type {
  subscriptionPriceMigrationListQuerySchema,
  subscriptionPriceMigrationPreviewBodySchema,
} from './schemas';

export type SubscriptionPriceMigrationPreviewBody = z.output<
  typeof subscriptionPriceMigrationPreviewBodySchema
>;
export type SubscriptionPriceMigrationListQuery = z.output<
  typeof subscriptionPriceMigrationListQuerySchema
>;
export type SubscriptionPriceMigrationAction = 'approve' | 'cancel' | 'retry';

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  COLLECTION_CURSOR_INVALID: 'Subscription migration cursor is invalid',
  COLLECTION_LIMIT_INVALID: 'Subscription migration list limit is invalid',
  IDEMPOTENCY_CONFLICT: 'Idempotency key conflicts with an existing subscription migration request',
  IDEMPOTENCY_IN_PROGRESS: 'Subscription migration request is already in progress',
  IDEMPOTENCY_RECONCILIATION_REQUIRED: 'Subscription migration request requires reconciliation',
  IDEMPOTENCY_RESULT_PERSISTENCE_FAILED: 'Subscription migration result persistence failed',
  PROVIDER_CAPABILITY_NOT_SUPPORTED: 'Provider capability is not supported for this migration',
  SUBSCRIPTION_MIGRATION_NOT_FOUND: 'Subscription migration was not found',
  SUBSCRIPTION_MIGRATION_PREVIEW_STALE: 'Subscription migration preview is stale',
  SUBSCRIPTION_MIGRATION_PREVIEW_STORAGE_REQUIRED: 'Subscription migration storage is unavailable',
  SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED: 'Provider did not apply the subscription migration',
  SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED: 'Subscription migration requires reconciliation',
  SUBSCRIPTION_MIGRATION_RENEWAL_DATE_REQUIRED:
    'A valid current renewal date is required for next-renewal migration',
  SUBSCRIPTION_MIGRATION_STATE_CONFLICT:
    'Subscription migration state does not permit this operation',
  SUBSCRIPTION_MIGRATION_TARGET_INELIGIBLE: 'Subscription migration target is ineligible',
  SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED: 'Subscription mutation requires reconciliation',
};

export async function runSubscriptionPriceMigrationPreview(
  payable: Payable,
  body: SubscriptionPriceMigrationPreviewBody,
  tenantId: string | null,
  authorization: AuthorizationContext | undefined,
  idempotencyKey: string,
) {
  const tenant = requireAccess(tenantId, authorization);
  const timing =
    body.effectiveTiming === 'scheduled'
      ? { effectiveTiming: body.effectiveTiming, effectiveAt: body.effectiveAt }
      : { effectiveTiming: body.effectiveTiming };
  try {
    const migration = await payable.subscriptionPriceMigrations(tenant).preview({
      subscriptionId: body.subscriptionId,
      targetPriceId: body.targetPriceId,
      itemId: body.itemId,
      quantity: body.quantity,
      timing,
      prorationPolicy: body.prorationPolicy,
      paymentFailurePolicy: body.paymentFailurePolicy,
      idempotencyKey,
    });
    return migrationDto(migration);
  } catch (error) {
    throw safeMigrationError(error);
  }
}

export async function runSubscriptionPriceMigrationList(
  payable: Payable,
  input: SubscriptionPriceMigrationListQuery,
  tenantId: string | null,
  authorization: AuthorizationContext | undefined,
) {
  const tenant = requireAccess(tenantId, authorization);
  try {
    const page = await payable.subscriptionPriceMigrations(tenant).list(input);
    return {
      items: page.items.map(migrationDto),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    throw safeMigrationError(error);
  }
}

export async function runSubscriptionPriceMigrationRetrieve(
  payable: Payable,
  id: string,
  tenantId: string | null,
  authorization: AuthorizationContext | undefined,
) {
  const tenant = requireAccess(tenantId, authorization);
  try {
    return migrationDto(await payable.subscriptionPriceMigrations(tenant).retrieve(id));
  } catch (error) {
    throw safeMigrationError(error);
  }
}

export async function runSubscriptionPriceMigrationAction(
  payable: Payable,
  action: SubscriptionPriceMigrationAction,
  id: string,
  tenantId: string | null,
  authorization: AuthorizationContext | undefined,
  idempotencyKey: string,
) {
  const tenant = requireAccess(tenantId, authorization);
  try {
    const migration = await payable
      .subscriptionPriceMigrations(tenant)
      [action](id, { idempotencyKey });
    return migrationDto(migration);
  } catch (error) {
    throw safeMigrationError(error);
  }
}

function requireAccess(
  tenantId: string | null,
  authorization: AuthorizationContext | undefined,
): string {
  if (typeof tenantId !== 'string' || tenantId.length === 0 || tenantId.trim() !== tenantId) {
    throw new PayableError('A tenant is required for subscription price migrations', {
      code: 'TENANT_REQUIRED',
    });
  }
  if (!isAuthorized(authorization) || authorization?.tenantId !== tenantId) {
    throw new PayableError('Not authorized to access subscription price migrations', {
      code: 'AUTHORIZATION_DENIED',
    });
  }
  return tenantId;
}

function safeMigrationError(error: unknown): PayableError {
  if (error instanceof PayableError) {
    const message = SAFE_ERROR_MESSAGES[error.code];
    if (message) {
      return new PayableError(message, {
        code: error.code,
        correlationId:
          error.code === 'IDEMPOTENCY_RESULT_PERSISTENCE_FAILED' ||
          error.code === 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED'
            ? error.correlationId
            : undefined,
        context:
          error.code === 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED'
            ? { claimReference: error.context?.claimReference }
            : undefined,
      });
    }
  }
  return new PayableError('Subscription migration operation failed', {
    code: 'SUBSCRIPTION_MIGRATION_OPERATION_FAILED',
  });
}

function migrationDto(migration: SubscriptionPriceMigration) {
  return {
    id: migration.id,
    tenantId: migration.tenantId,
    subscriptionId: migration.subscriptionId,
    sourcePriceId: migration.sourcePriceId,
    targetPriceId: migration.targetPriceId,
    sourcePrice: priceDto(migration.sourcePrice),
    targetPrice: priceDto(migration.targetPrice),
    currentItems: migration.currentItems.map(itemDto),
    proposedItems: migration.proposedItems.map(itemDto),
    effectiveTiming: migration.effectiveTiming,
    effectiveAt: migration.effectiveAt,
    prorationPolicy: migration.prorationPolicy,
    paymentFailurePolicy: migration.paymentFailurePolicy,
    immediateAdjustment: adjustmentDto(migration.immediateAdjustment),
    nextRenewal: renewalDto(migration.nextRenewal),
    currentRenewalDate: migration.currentRenewalDate,
    warnings: migration.warnings.map((warning) => warning),
    providerLimitations: migration.providerLimitations.map((limitation) => limitation),
    previewToken: migration.previewToken,
    calculatedAt: migration.calculatedAt,
    expiresAt: migration.expiresAt,
    status: migration.status,
    attemptCount: migration.attemptCount,
    scheduledAt: migration.scheduledAt,
    executionStartedAt: migration.executionStartedAt,
    appliedAt: migration.appliedAt,
    failedAt: migration.failedAt,
    reconciliationRequiredAt: migration.reconciliationRequiredAt,
    reconciliationObservationEvidenceReference:
      migration.reconciliationObservationEvidenceReference,
    reconciliationObservedAt: migration.reconciliationObservedAt,
    cancelledAt: migration.cancelledAt,
    createdAt: migration.createdAt,
    updatedAt: migration.updatedAt,
  };
}

function priceDto(price: SubscriptionPriceMigration['sourcePrice']) {
  return {
    id: price.id,
    productId: price.productId,
    amount: price.amount,
    currency: price.currency,
    interval: price.interval,
    intervalCount: price.intervalCount,
  };
}

function itemDto(item: SubscriptionPriceMigration['currentItems'][number]) {
  return { id: item.id, priceId: item.priceId, quantity: item.quantity };
}

function adjustmentDto(adjustment: SubscriptionPriceMigration['immediateAdjustment']) {
  return {
    direction: adjustment.direction,
    amount: adjustment.amount,
    currency: adjustment.currency,
  };
}

function renewalDto(renewal: SubscriptionPriceMigration['nextRenewal']) {
  return { amount: renewal.amount, currency: renewal.currency, date: renewal.date };
}
