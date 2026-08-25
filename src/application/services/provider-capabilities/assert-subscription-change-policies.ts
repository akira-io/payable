import type {
  SubscriptionChangeCapabilities,
} from '../../../domain/dtos/subscription-operation-capabilities.dto';
import type { SubscriptionChangePolicies } from '../../../domain/dtos/subscription-change.dto';
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
