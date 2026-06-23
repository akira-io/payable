import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import type { ProviderCapability } from '../../../domain/dtos/capabilities.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';

export function assertProviderCapability(
  provider: PaymentProvider,
  capability: ProviderCapability,
): void {
  if (!provider.capabilities()[capability]) {
    throw new ProviderCapabilityNotSupportedError(provider.name, capability);
  }
}
