import type { TaxProvider } from './domain/contracts/tax-provider.contract';
import { TaxProviderNotFoundError } from './domain/errors/tax-provider-not-found.error';

export class TaxProviderRegistry {
  constructor(private readonly providers: Map<string, TaxProvider>) {}

  register(name: string, provider: TaxProvider): void {
    this.providers.set(name, provider);
  }

  get(name: string): TaxProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new TaxProviderNotFoundError(name);
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
