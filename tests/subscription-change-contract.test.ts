import { describe, expect, it } from 'vitest';
import { assertSubscriptionChangePolicies } from '../src/application/services/provider-capabilities/assert-subscription-change-policies';
import {
  defineSubscriptionOperationCapabilities,
  NO_SUBSCRIPTION_OPERATIONS,
} from '../src/domain/dtos/subscription-operation-capabilities.dto';
import { ProviderCapabilityNotSupportedError } from '../src/domain/errors/provider-capability-not-supported.error';

const capabilities = defineSubscriptionOperationCapabilities({
  ...NO_SUBSCRIPTION_OPERATIONS,
  changePrice: {
    preview: true,
    effectiveTimings: ['immediate'],
    prorationPolicies: ['prorateImmediately'],
    paymentFailurePolicies: ['preventChange'],
  },
});

describe('subscription change policy contract', () => {
  it('accepts an explicitly supported policy combination', () => {
    expect(() =>
      assertSubscriptionChangePolicies('stripe', capabilities.changePrice, {
        effectiveTiming: 'immediate',
        prorationPolicy: 'prorateImmediately',
        paymentFailurePolicy: 'preventChange',
      }),
    ).not.toThrow();
  });

  it('rejects an unsupported policy with a stable capability error', () => {
    expect(() =>
      assertSubscriptionChangePolicies('stripe', capabilities.changePrice, {
        effectiveTiming: 'nextRenewal',
        prorationPolicy: 'prorateImmediately',
        paymentFailurePolicy: 'preventChange',
      }),
    ).toThrow(ProviderCapabilityNotSupportedError);

    try {
      assertSubscriptionChangePolicies('stripe', capabilities.changePrice, {
        effectiveTiming: 'nextRenewal',
        prorationPolicy: 'prorateImmediately',
        paymentFailurePolicy: 'preventChange',
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
        context: { provider: 'stripe', capability: 'subscriptions.change.nextRenewal' },
      });
    }
  });
});
