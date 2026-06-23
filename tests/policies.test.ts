import { describe, expect, it } from 'vitest';
import { CanCancelSubscriptionPolicy } from '../src/application/policies/can-cancel-subscription.policy';
import { CanCreateCheckoutPolicy } from '../src/application/policies/can-create-checkout.policy';
import { CanCreateSubscriptionPolicy } from '../src/application/policies/can-create-subscription.policy';
import { CanRefundPaymentPolicy } from '../src/application/policies/can-refund-payment.policy';
import { CanResumeSubscriptionPolicy } from '../src/application/policies/can-resume-subscription.policy';

const policies = [
  new CanCreateCheckoutPolicy(),
  new CanCreateSubscriptionPolicy(),
  new CanCancelSubscriptionPolicy(),
  new CanRefundPaymentPolicy(),
  new CanResumeSubscriptionPolicy(),
];

describe('billing authorization policies', () => {
  it('default-deny when no context is supplied', () => {
    for (const policy of policies) {
      expect(policy.authorize()).toBe(false);
    }
  });

  it('deny when allowed is true but no actor is identified', () => {
    for (const policy of policies) {
      expect(policy.authorize({ allowed: true })).toBe(false);
    }
  });

  it('deny when an actor is present but not allowed', () => {
    for (const policy of policies) {
      expect(policy.authorize({ actorId: 'user_1' })).toBe(false);
    }
  });

  it('allow only when explicitly allowed for an identified actor', () => {
    for (const policy of policies) {
      expect(policy.authorize({ allowed: true, actorId: 'user_1' })).toBe(true);
    }
  });
});
