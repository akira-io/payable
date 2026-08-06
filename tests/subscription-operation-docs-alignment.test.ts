import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PaymentProvider } from '../src/domain/contracts/payment-provider.contract';
import type {
  SubscriptionEffectiveTiming,
  SubscriptionOperationCapabilities,
  SubscriptionPaymentFailurePolicy,
  SubscriptionProrationPolicy,
  SubscriptionResumeBillingPolicy,
} from '../src/domain/dtos/subscription-operation-capabilities.dto';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';
import { RevolutProvider } from '../src/infrastructure/providers/revolut/revolut-provider';
import { SispProvider } from '../src/infrastructure/providers/sisp/sisp-provider';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import { ProviderRegistry } from '../src/provider-registry';

const providers = {
  Stripe: new StripeProvider({ secretKey: 'stripe-secret', webhookSecret: 'stripe-webhook' }),
  Paddle: new PaddleProvider({ apiKey: 'paddle-key', webhookSecret: 'paddle-webhook' }),
  SISP: new SispProvider({} as ConstructorParameters<typeof SispProvider>[0]),
  Revolut: new RevolutProvider({ secretKey: 'revolut-key', webhookSecret: 'revolut-webhook' }),
} satisfies Record<string, PaymentProvider>;

const timingLabels: Record<SubscriptionEffectiveTiming, string> = {
  immediate: 'immediate',
  nextRenewal: 'next renewal',
  scheduled: 'scheduled',
};

const prorationLabels: Record<SubscriptionProrationPolicy, string> = {
  prorateImmediately: 'immediate',
  prorateAtNextRenewal: 'next invoice',
  chargeFullImmediately: 'full charge immediately',
  chargeFullAtNextRenewal: 'full charge at next renewal',
  none: 'none',
};

const failureLabels: Record<SubscriptionPaymentFailurePolicy, string> = {
  preventChange: 'prevent change',
  applyChange: 'apply change',
};

const resumeBillingLabels: Record<SubscriptionResumeBillingPolicy, string> = {
  startNewBillingPeriod: 'new billing period',
  continueExistingBillingPeriod: 'existing billing period',
};

function formatBooleanSupport(isSupported: boolean): string {
  return isSupported ? 'yes' : 'no';
}

function formatCapabilityValues<T extends string>(
  capabilityValues: readonly T[],
  labels: Record<T, string>,
): string {
  return capabilityValues.length === 0
    ? 'no'
    : capabilityValues.map((capabilityValue) => labels[capabilityValue]).join(', ');
}

function documentedOperations(
  capabilities: SubscriptionOperationCapabilities,
): Record<string, string> {
  const resumePaused = capabilities.resume.pausedSubscription
    ? `yes, ${formatCapabilityValues(capabilities.resume.billingPolicies, resumeBillingLabels)}`
    : 'no';
  return {
    'Hosted checkout creation': formatBooleanSupport(capabilities.create.checkout),
    'Direct creation': formatBooleanSupport(capabilities.create.direct),
    'Price change timing': formatCapabilityValues(
      capabilities.changePrice.effectiveTimings,
      timingLabels,
    ),
    'Price change proration': formatCapabilityValues(
      capabilities.changePrice.prorationPolicies,
      prorationLabels,
    ),
    'Price change payment failure': formatCapabilityValues(
      capabilities.changePrice.paymentFailurePolicies,
      failureLabels,
    ),
    'Quantity change': formatCapabilityValues(
      capabilities.changeQuantity.effectiveTimings,
      timingLabels,
    ),
    'Preview change': formatBooleanSupport(
      capabilities.changePrice.preview || capabilities.changeQuantity.preview,
    ),
    'Cancel immediately': formatBooleanSupport(capabilities.cancel.immediately),
    'Cancel at period end': formatBooleanSupport(capabilities.cancel.atPeriodEnd),
    Pause: formatBooleanSupport(capabilities.pause.effectiveTimings.length > 0),
    'Resume pending cancellation': formatBooleanSupport(capabilities.resume.pendingCancellation),
    'Resume paused subscription': resumePaused,
  };
}

function tableCells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

describe('subscription operation documentation', () => {
  it('matches every built-in runtime descriptor', () => {
    const markdown = readFileSync('docs/integrations/17-providers.md', 'utf8');
    const start = markdown.indexOf('| Subscription operation | Stripe | Paddle | SISP | Revolut |');
    const end = markdown.indexOf('\n\nThis matrix describes', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const rows = markdown.slice(start, end).split('\n').slice(2).map(tableCells);
    const registry = new ProviderRegistry(
      new Map(Object.values(providers).map((provider) => [provider.name, provider])),
    );

    for (const [index, [name, provider]] of Object.entries(providers).entries()) {
      const expectedOperations = documentedOperations(
        registry.subscriptionOperationCapabilities(provider.name),
      );
      for (const [label, ...cells] of rows) {
        expect(cells[index], `${label} on ${name}`).toBe(expectedOperations[label ?? '']);
      }
    }
  });
});
