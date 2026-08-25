export const SUBSCRIPTION_PRICE_MIGRATION_FAILURES = Object.freeze({
  SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED: 'Provider did not apply the subscription migration',
  SUBSCRIPTION_MIGRATION_PROVIDER_OUTCOME_UNKNOWN:
    'Provider outcome is unknown and requires reconciliation',
  SUBSCRIPTION_MIGRATION_PROVIDER_IDENTITY_MISMATCH:
    'Provider subscription identity mismatch requires reconciliation',
  SUBSCRIPTION_MIGRATION_PROJECTION_FAILED: 'Canonical projection failed after provider success',
} as const);

export type SubscriptionPriceMigrationFailureCode =
  keyof typeof SUBSCRIPTION_PRICE_MIGRATION_FAILURES;

export type SubscriptionPriceMigrationFailure = {
  [Code in SubscriptionPriceMigrationFailureCode]: {
    readonly code: Code;
    readonly message: (typeof SUBSCRIPTION_PRICE_MIGRATION_FAILURES)[Code];
  };
}[SubscriptionPriceMigrationFailureCode];

export function subscriptionPriceMigrationFailure(
  code: SubscriptionPriceMigrationFailureCode,
): SubscriptionPriceMigrationFailure {
  return {
    code,
    message: SUBSCRIPTION_PRICE_MIGRATION_FAILURES[code],
  } as SubscriptionPriceMigrationFailure;
}

export function isSubscriptionPriceMigrationFailureCode(
  value: unknown,
): value is SubscriptionPriceMigrationFailureCode {
  return typeof value === 'string' && value in SUBSCRIPTION_PRICE_MIGRATION_FAILURES;
}

export function isSubscriptionPriceMigrationFailure(
  code: unknown,
  message: unknown,
): code is SubscriptionPriceMigrationFailureCode {
  return (
    isSubscriptionPriceMigrationFailureCode(code) &&
    message === SUBSCRIPTION_PRICE_MIGRATION_FAILURES[code]
  );
}
