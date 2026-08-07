import type {
  SubscriptionChangeCapabilities,
  SubscriptionEffectiveTiming,
  SubscriptionPaymentFailurePolicy,
  SubscriptionProrationPolicy,
} from '../../../domain/dtos/subscription-operation-capabilities.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';

export interface SubscriptionChangePolicies {
  effectiveTiming: SubscriptionEffectiveTiming;
  prorationPolicy: SubscriptionProrationPolicy;
  paymentFailurePolicy: SubscriptionPaymentFailurePolicy;
}

export function assertSubscriptionChangePolicies(
  providerName: string,
  capabilities: SubscriptionChangeCapabilities,
  policies: SubscriptionChangePolicies,
): void {
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
