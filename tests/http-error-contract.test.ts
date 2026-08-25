import { describe, expect, it } from 'vitest';
import { PayableError } from '../src/domain/errors/payable-error';
import { payableErrorBody, payableErrorStatus } from '../src/presentation/shared/payable-http';

describe('subscription migration HTTP errors', () => {
  it.each([
    ['SUBSCRIPTION_MIGRATION_NOT_FOUND', 404],
    ['SUBSCRIPTION_MIGRATION_PREVIEW_STALE', 409],
    ['SUBSCRIPTION_MIGRATION_TARGET_INELIGIBLE', 422],
    ['PROVIDER_CAPABILITY_NOT_SUPPORTED', 422],
    ['SUBSCRIPTION_MIGRATION_STATE_CONFLICT', 409],
    ['SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED', 409],
    ['SUBSCRIPTION_MIGRATION_RENEWAL_DATE_REQUIRED', 422],
    ['SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED', 422],
    ['SUBSCRIPTION_MIGRATION_PREVIEW_STORAGE_REQUIRED', 500],
  ])('maps %s to an exact stable response', (code, status) => {
    const error = new PayableError('stable message', { code });

    expect(payableErrorStatus(error)).toBe(status);
    expect(payableErrorBody(error)).toEqual({ error: code, message: 'stable message' });
  });

  it('preserves only safe durable mutation-claim recovery metadata', () => {
    const error = new PayableError('raw storage detail', {
      code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
      correlationId: 'correlation-safe-1',
      context: { claimReference: 'claim-safe-1', providerRequest: 'must-not-leak' },
    });

    expect(payableErrorStatus(error)).toBe(409);
    expect(payableErrorBody(error)).toEqual({
      error: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
      message: 'Subscription mutation requires reconciliation',
      correlationId: 'correlation-safe-1',
      claimReference: 'claim-safe-1',
      guidance:
        'Resolve the retained subscription mutation claim before attempting another provider mutation.',
    });
  });
});
