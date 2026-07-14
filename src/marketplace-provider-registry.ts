import type { MarketplaceProvider } from './domain/contracts/marketplace-provider.contract';
import { MarketplaceProviderNotFoundError } from './domain/errors/marketplace-provider-not-found.error';

export class MarketplaceProviderRegistry {
  constructor(private readonly providers: Map<string, MarketplaceProvider>) {}

  register(name: string, provider: MarketplaceProvider): void {
    this.providers.set(name, provider);
  }

  get(name: string): MarketplaceProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new MarketplaceProviderNotFoundError(name);
    }
    return provider;
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  names(): string[] {
    return [...this.providers.keys()];
  }
}
