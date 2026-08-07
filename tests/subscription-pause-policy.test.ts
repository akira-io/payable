import { describe, expect, it } from 'vitest';
import {
  validatePausePaymentCollectionPolicy,
  validatePauseSubscriptionPolicy,
  validateResumePausedSubscriptionPolicy,
} from '../src/domain/dtos/subscription-pause-policy.dto';

const now = new Date('2026-08-07T10:00:00.000Z');

describe('subscription pause policies', () => {
  it('accepts explicit indefinite and scheduled lifecycle pause policies', () => {
    expect(
      validatePauseSubscriptionPolicy(
        {
          effectiveTiming: 'immediate',
          resumeAt: null,
          resumeBillingPolicy: 'startNewBillingPeriod',
        },
        now,
      ),
    ).toBeUndefined();
    expect(
      validatePauseSubscriptionPolicy(
        {
          effectiveTiming: 'nextRenewal',
          resumeAt: new Date('2026-09-07T10:00:00.000Z'),
          resumeBillingPolicy: 'continueExistingBillingPeriod',
        },
        now,
      ),
    ).toBeUndefined();
  });

  it('rejects a non-future lifecycle resume date', () => {
    expect(() =>
      validatePauseSubscriptionPolicy(
        {
          effectiveTiming: 'immediate',
          resumeAt: new Date('2026-08-07T10:00:00.000Z'),
          resumeBillingPolicy: 'startNewBillingPeriod',
        },
        now,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'SUBSCRIPTION_PAUSE_POLICY_INVALID',
        context: { field: 'resumeAt' },
      }),
    );
  });

  it('requires a future effective date for scheduled resume', () => {
    expect(() =>
      validateResumePausedSubscriptionPolicy(
        {
          effectiveTiming: 'scheduled',
          effectiveAt: new Date('invalid'),
          billingPolicy: 'startNewBillingPeriod',
        },
        now,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'SUBSCRIPTION_RESUME_POLICY_INVALID',
        context: { field: 'effectiveAt' },
      }),
    );
  });

  it('rejects invalid runtime payment collection policies', () => {
    expect(() =>
      validatePausePaymentCollectionPolicy({ behavior: 'discard' as 'void', resumesAt: null }, now),
    ).toThrowError(
      expect.objectContaining({ code: 'SUBSCRIPTION_PAYMENT_COLLECTION_POLICY_INVALID' }),
    );
  });
});
