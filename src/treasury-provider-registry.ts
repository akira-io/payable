import type { TreasuryProvider } from './domain/contracts/treasury-provider.contract';
import { TreasuryProviderNotFoundError } from './domain/errors/treasury-provider-not-found.error';

export class TreasuryProviderRegistry {
  constructor(private readonly providers: Map<string, TreasuryProvider>) {}

  register(name: string, provider: TreasuryProvider): void {
    this.providers.set(name, provider);
  }

  get(name: string): TreasuryProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new TreasuryProviderNotFoundError(name);
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
