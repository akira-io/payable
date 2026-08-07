import { describe, expect, it } from 'vitest';
import {
  assertSubscriptionOperation,
  defineSubscriptionOperationCapabilities,
  isSubscriptionOperationCapabilitiesProvider,
  NO_SUBSCRIPTION_OPERATIONS,
  PaddleProvider,
  ProviderRegistry,
  RevolutProvider,
  StripeProvider,
} from '../src/index';
import { SispProvider } from '../src/infrastructure/providers/sisp/sisp-provider';
import { FakeProvider } from './support/fake-provider';
import {
  DescribedProvider,
  LegacySubscriptionProvider,
} from './support/subscription-capability-providers';

const NO_OPERATIONS = {
  create: { checkout: false, direct: false },
  changePrice: {
    preview: false,
    effectiveTimings: [],
    prorationPolicies: [],
    paymentFailurePolicies: [],
  },
  changeQuantity: {
    preview: false,
    effectiveTimings: [],
    prorationPolicies: [],
    paymentFailurePolicies: [],
  },
  cancel: { immediately: false, atPeriodEnd: false },
  pause: {
    subscription: {
      effectiveTimings: [],
      scheduledResume: false,
      resumeBillingPolicies: [],
    },
    paymentCollection: { behaviors: [], scheduledResume: false },
  },
  resume: {
    pendingCancellation: false,
    pausedSubscription: { effectiveTimings: [], billingPolicies: [] },
    paymentCollection: false,
  },
  scheduledChange: { cancel: false },
};

describe('subscription operation capabilities', () => {
  it('exports a serializable immutable empty descriptor', () => {
    expect(JSON.parse(JSON.stringify(NO_SUBSCRIPTION_OPERATIONS))).toEqual(NO_OPERATIONS);
    expect(Object.isFrozen(NO_SUBSCRIPTION_OPERATIONS)).toBe(true);
    expect(Object.isFrozen(NO_SUBSCRIPTION_OPERATIONS.changePrice.effectiveTimings)).toBe(true);
  });

  it('creates an immutable descriptor without retaining mutable policy arrays', () => {
    const effectiveTimings = ['immediate'] as const;
    const descriptor = defineSubscriptionOperationCapabilities({
      ...NO_OPERATIONS,
      changePrice: {
        ...NO_OPERATIONS.changePrice,
        effectiveTimings,
      },
    });

    expect(descriptor.changePrice.effectiveTimings).toEqual(['immediate']);
    expect(descriptor.changePrice.effectiveTimings).not.toBe(effectiveTimings);
    expect(Object.isFrozen(descriptor.changePrice)).toBe(true);
    expect(Object.isFrozen(descriptor.changePrice.effectiveTimings)).toBe(true);
  });

  it('returns an explicit provider descriptor through the registry', () => {
    const descriptor = defineSubscriptionOperationCapabilities({
      ...NO_OPERATIONS,
      create: { checkout: true, direct: true },
    });
    const registry = new ProviderRegistry(
      new Map([['described', new DescribedProvider(descriptor)]]),
    );

    expect(registry.subscriptionOperationCapabilities('described')).toEqual(descriptor);
  });

  it('uses a conservative creation-only fallback for legacy providers', () => {
    const registry = new ProviderRegistry(new Map([['legacy', new LegacySubscriptionProvider()]]));

    expect(registry.subscriptionOperationCapabilities('legacy')).toEqual({
      ...NO_OPERATIONS,
      create: { checkout: true, direct: true },
    });
  });

  it('returns immutable snapshots that callers cannot alter', () => {
    const descriptor = defineSubscriptionOperationCapabilities({
      ...NO_OPERATIONS,
      changePrice: {
        ...NO_OPERATIONS.changePrice,
        effectiveTimings: ['immediate'],
      },
    });
    const registry = new ProviderRegistry(
      new Map([['described', new DescribedProvider(descriptor)]]),
    );

    const first = registry.subscriptionOperationCapabilities('described');
    const second = registry.subscriptionOperationCapabilities('described');
    expect(first).not.toBe(second);
    expect(() => (first.changePrice.effectiveTimings as string[]).push('scheduled')).toThrow();
    expect(second.changePrice.effectiveTimings).toEqual(['immediate']);
  });

  it.each([
    [
      'stripe',
      new StripeProvider({ secretKey: 'stripe-secret', webhookSecret: 'stripe-webhook' }),
      {
        ...NO_OPERATIONS,
        create: { checkout: true, direct: true },
        changePrice: {
          preview: false,
          effectiveTimings: ['immediate'],
          prorationPolicies: ['prorateAtNextRenewal'],
          paymentFailurePolicies: ['applyChange'],
        },
        changeQuantity: {
          preview: false,
          effectiveTimings: ['immediate'],
          prorationPolicies: ['prorateAtNextRenewal'],
          paymentFailurePolicies: ['applyChange'],
        },
        cancel: { immediately: true, atPeriodEnd: true },
        pause: {
          ...NO_OPERATIONS.pause,
          paymentCollection: {
            behaviors: ['keepAsDraft', 'markUncollectible', 'void'],
            scheduledResume: true,
          },
        },
        resume: {
          ...NO_OPERATIONS.resume,
          pendingCancellation: true,
          paymentCollection: true,
        },
      },
    ],
    [
      'paddle',
      new PaddleProvider({ apiKey: 'paddle-key', webhookSecret: 'paddle-webhook' }),
      {
        ...NO_OPERATIONS,
        create: { checkout: true, direct: false },
        changePrice: {
          preview: false,
          effectiveTimings: ['immediate'],
          prorationPolicies: ['prorateImmediately'],
          paymentFailurePolicies: ['preventChange'],
        },
        changeQuantity: {
          preview: false,
          effectiveTimings: ['immediate'],
          prorationPolicies: ['prorateImmediately'],
          paymentFailurePolicies: ['preventChange'],
        },
        cancel: { immediately: true, atPeriodEnd: true },
        pause: {
          ...NO_OPERATIONS.pause,
          subscription: {
            effectiveTimings: ['immediate', 'nextRenewal'],
            scheduledResume: true,
            resumeBillingPolicies: ['startNewBillingPeriod', 'continueExistingBillingPeriod'],
          },
        },
        resume: {
          ...NO_OPERATIONS.resume,
          pausedSubscription: {
            effectiveTimings: ['immediate', 'scheduled'],
            billingPolicies: ['startNewBillingPeriod', 'continueExistingBillingPeriod'],
          },
        },
        scheduledChange: { cancel: true },
      },
    ],
    [
      'revolut',
      new RevolutProvider({ secretKey: 'revolut-key', webhookSecret: 'revolut-webhook' }),
      {
        ...NO_OPERATIONS,
        create: { checkout: true, direct: true },
        changePrice: {
          ...NO_OPERATIONS.changePrice,
          effectiveTimings: ['nextRenewal'],
        },
        cancel: { immediately: true, atPeriodEnd: false },
      },
    ],
    ['sisp', new SispProvider({} as ConstructorParameters<typeof SispProvider>[0]), NO_OPERATIONS],
    [
      'test',
      new FakeProvider(),
      {
        ...NO_OPERATIONS,
        create: { checkout: true, direct: true },
        changePrice: {
          ...NO_OPERATIONS.changePrice,
          effectiveTimings: ['immediate'],
        },
        changeQuantity: {
          ...NO_OPERATIONS.changeQuantity,
          effectiveTimings: ['immediate'],
        },
        cancel: { immediately: true, atPeriodEnd: true },
        resume: {
          ...NO_OPERATIONS.resume,
          pendingCancellation: true,
          pausedSubscription: {
            effectiveTimings: ['immediate'],
            billingPolicies: ['startNewBillingPeriod'],
          },
        },
      },
    ],
  ] as const)('reports the %s runtime subscription operations honestly', (_name, provider, expected) => {
    expect(isSubscriptionOperationCapabilitiesProvider(provider)).toBe(true);
    const registry = new ProviderRegistry(new Map([[provider.name, provider]]));

    expect(registry.subscriptionOperationCapabilities(provider.name)).toEqual(expected);
  });

  it.each([
    ['createCheckout', 'subscriptions.create.checkout'],
    ['createDirect', 'subscriptions.create.direct'],
    ['changePrice', 'subscriptions.change-price'],
    ['changeQuantity', 'subscriptions.change-quantity'],
    ['cancelImmediately', 'subscriptions.cancel.immediately'],
    ['cancelAtPeriodEnd', 'subscriptions.cancel.at-period-end'],
    ['pause', 'subscriptions.pause'],
    ['resume', 'subscriptions.resume'],
  ] as const)('rejects unsupported %s operations with a stable capability', (operation, capability) => {
    const provider = new DescribedProvider(NO_SUBSCRIPTION_OPERATIONS);

    expect(() => assertSubscriptionOperation(provider, operation)).toThrowError(
      expect.objectContaining({
        code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
        context: { provider: 'legacy', capability },
      }),
    );
  });

  it('does not reject legacy providers that cannot publish granular semantics yet', () => {
    const provider = new LegacySubscriptionProvider();

    expect(() => assertSubscriptionOperation(provider, 'changePrice')).not.toThrow();
  });
});
