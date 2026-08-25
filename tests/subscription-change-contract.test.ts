import { describe, expect, it } from 'vitest';
import { assertSubscriptionChangePolicies } from '../src/application/services/provider-capabilities/assert-subscription-change-policies';
import type { SubscriptionChangeApplicationOutcome } from '../src/domain/contracts/subscription-change-provider.contract';
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

const definitiveNoSideEffects = {
  kind: 'not_applied',
  sideEffects: 'definitively_none',
  code: 'PROVIDER_REJECTED',
} satisfies SubscriptionChangeApplicationOutcome;
type MissingSideEffectsRejected = {
  kind: 'not_applied';
  code: string;
} extends SubscriptionChangeApplicationOutcome
  ? false
  : true;
type UncertainSideEffectsRejected = {
  kind: 'not_applied';
  sideEffects: 'unknown';
  code: string;
} extends SubscriptionChangeApplicationOutcome
  ? false
  : true;
const missingSideEffectsRejected: MissingSideEffectsRejected = true;
const uncertainSideEffectsRejected: UncertainSideEffectsRejected = true;

void definitiveNoSideEffects;
void missingSideEffectsRejected;
void uncertainSideEffectsRejected;

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
