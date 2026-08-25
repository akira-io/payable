import { PayableError, type PayableErrorOptions } from './payable-error';

export type SubscriptionPriceMigrationErrorCode =
  | 'SUBSCRIPTION_MIGRATION_NOT_FOUND'
  | 'SUBSCRIPTION_MIGRATION_PREVIEW_STALE'
  | 'SUBSCRIPTION_MIGRATION_PREVIEW_STORAGE_REQUIRED'
  | 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED'
  | 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED'
  | 'SUBSCRIPTION_MIGRATION_RENEWAL_DATE_REQUIRED'
  | 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT'
  | 'SUBSCRIPTION_MIGRATION_TARGET_INELIGIBLE'
  | 'SUBSCRIPTION_MUTATION_CLAIM_CONFLICT'
  | 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED';

export class SubscriptionPriceMigrationError extends PayableError {
  constructor(
    message: string,
    code: SubscriptionPriceMigrationErrorCode,
    options: PayableErrorOptions = {},
  ) {
    super(message, { ...options, code });
  }
}
