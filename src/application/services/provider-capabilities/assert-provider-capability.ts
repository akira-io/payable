import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import type { ProviderCapabilityValue } from '../../../domain/dtos/capabilities.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';

export function assertProviderCapability(
  provider: PaymentProvider,
  capability: ProviderCapabilityValue,
): void {
  if (!provider.capabilities().has(capability)) {
    throw new ProviderCapabilityNotSupportedError(provider.name, capability);
  }
}
