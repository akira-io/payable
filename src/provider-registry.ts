import type { PaymentProvider } from './domain/contracts/payment-provider.contract';
import { resolveSubscriptionOperationCapabilities } from './domain/contracts/subscription-operation-capabilities-provider.contract';
import type { SubscriptionOperationCapabilities } from './domain/dtos/subscription-operation-capabilities.dto';
import { ProviderNotFoundError } from './domain/errors/provider-not-found.error';

export class ProviderRegistry {
  constructor(private readonly providers: Map<string, PaymentProvider>) {}

  register(name: string, provider: PaymentProvider): void {
    this.providers.set(name, provider);
  }

  get(name: string): PaymentProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ProviderNotFoundError(name);
    }
    return provider;
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  names(): string[] {
    return [...this.providers.keys()];
  }

  subscriptionOperationCapabilities(name: string): SubscriptionOperationCapabilities {
    return resolveSubscriptionOperationCapabilities(this.get(name));
  }
}
