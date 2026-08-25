import type { SubscriptionChangePolicies } from '../../../domain/dtos/subscription-change.dto';
import type { SubscriptionChangeCapabilities } from '../../../domain/dtos/subscription-operation-capabilities.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { assertSubscriptionChangeTiming } from '../../../domain/validation/subscription-change-policies';

export function assertSubscriptionChangePolicies(
  providerName: string,
  capabilities: SubscriptionChangeCapabilities,
  policies: SubscriptionChangePolicies,
): void {
  assertSubscriptionChangeTiming(policies);
  assertSupported(
    providerName,
    capabilities.effectiveTimings,
    policies.effectiveTiming,
    `subscriptions.change.${policies.effectiveTiming}`,
  );
  assertSupported(
    providerName,
    capabilities.prorationPolicies,
    policies.prorationPolicy,
    `subscriptions.change.${policies.prorationPolicy}`,
  );
  assertSupported(
    providerName,
    capabilities.paymentFailurePolicies,
    policies.paymentFailurePolicy,
    `subscriptions.change.${policies.paymentFailurePolicy}`,
  );
}

interface SubscriptionPriceTerms {
  readonly currency: string;
  readonly interval: string | null;
  readonly intervalCount: number | null;
}

export function assertSubscriptionChangeTerms(
  providerName: string,
  capabilities: SubscriptionChangeCapabilities,
  source: SubscriptionPriceTerms,
  target: SubscriptionPriceTerms,
): void {
  if (source.currency !== target.currency && !capabilities.supportsCurrencyChange) {
    throw new ProviderCapabilityNotSupportedError(providerName, 'subscriptions.change.currency');
  }
  const changesBillingPeriod =
    source.interval !== target.interval || source.intervalCount !== target.intervalCount;
  if (changesBillingPeriod && !capabilities.supportsBillingPeriodChange) {
    throw new ProviderCapabilityNotSupportedError(
      providerName,
      'subscriptions.change.billing-period',
    );
  }
}

function assertSupported<T extends string>(
  providerName: string,
  supportedValues: readonly T[],
  selectedValue: T,
  capability: string,
): void {
  if (!supportedValues.includes(selectedValue)) {
    throw new ProviderCapabilityNotSupportedError(providerName, capability);
  }
}
