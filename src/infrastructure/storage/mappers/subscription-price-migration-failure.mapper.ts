import {
  isSubscriptionPriceMigrationFailure,
  isSubscriptionPriceMigrationFailureCode,
  SUBSCRIPTION_PRICE_MIGRATION_FAILURES,
  type SubscriptionPriceMigrationFailure,
  type SubscriptionPriceMigrationFailureCode,
} from '../../../domain/value-objects/subscription-price-migration-failure';
import type { SubscriptionPriceMigrationStatus } from '../../../domain/value-objects/subscription-price-migration-status';

export function canonicalSubscriptionPriceMigrationFailure(
  status: SubscriptionPriceMigrationStatus,
  code: string | null,
  message: string | null,
): {
  code: SubscriptionPriceMigrationFailureCode | null;
  message: SubscriptionPriceMigrationFailure['message'] | null;
} {
  if (code === null && message === null) {
    if (status === 'failed' || status === 'reconciliation_required') invalid();
    return { code, message };
  }
  if (
    !isSubscriptionPriceMigrationFailureCode(code) ||
    !isSubscriptionPriceMigrationFailure(code, message) ||
    !['failed', 'reconciliation_required', 'cancelled'].includes(status)
  ) {
    return invalid();
  }
  return { code, message: SUBSCRIPTION_PRICE_MIGRATION_FAILURES[code] };
}

function invalid(): never {
  throw new Error('Invalid subscription price migration: failure_code');
}
