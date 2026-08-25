import type { SubscriptionPriceMigrationStateCompareAndSwap } from '../../domain/contracts';
import { canTransitionSubscriptionPriceMigrationStatus } from '../../domain/states/subscription-price-migration-state-machine';
import { isSubscriptionPriceMigrationFailure } from '../../domain/value-objects/subscription-price-migration-failure';

export function isValidSubscriptionPriceMigrationCas(
  input: SubscriptionPriceMigrationStateCompareAndSwap,
): boolean {
  if ((input.expectedStatus as string) === 'reconciliation_required') return false;
  const hasNoFailure = input.failureCode === null && input.failureMessage === null;
  const hasCanonicalFailure = isSubscriptionPriceMigrationFailure(
    input.failureCode,
    input.failureMessage,
  );
  if (!hasNoFailure && !hasCanonicalFailure) return false;
  if (
    (input.nextStatus === 'failed' || input.nextStatus === 'reconciliation_required') &&
    !hasCanonicalFailure
  ) {
    return false;
  }
  if (
    ['scheduled', 'executing', 'pending_renewal', 'applied'].includes(input.nextStatus) &&
    !hasNoFailure
  ) {
    return false;
  }
  if (!canTransitionSubscriptionPriceMigrationStatus(input.expectedStatus, input.nextStatus)) {
    return false;
  }
  if (input.nextStatus === 'scheduled') {
    return (
      input.expectedStatus === 'previewed' &&
      input.expectedExecutionToken === null &&
      input.executionToken === null
    );
  }
  if (input.nextStatus === 'executing') {
    return input.expectedExecutionToken === null && input.executionToken.length > 0;
  }
  if (input.nextStatus === 'cancelled') {
    return input.expectedExecutionToken === null && input.executionToken === null;
  }
  if (input.nextStatus === 'failed') {
    return (
      typeof input.expectedExecutionToken === 'string' &&
      input.expectedExecutionToken.length > 0 &&
      input.executionToken === null
    );
  }
  return (
    typeof input.expectedExecutionToken === 'string' &&
    input.expectedExecutionToken.length > 0 &&
    input.executionToken === input.expectedExecutionToken
  );
}
