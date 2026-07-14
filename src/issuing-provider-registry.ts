import type { IssuingProvider } from './domain/contracts/issuing-provider.contract';
import { IssuingProviderNotFoundError } from './domain/errors/issuing-provider-not-found.error';

export class IssuingProviderRegistry {
  constructor(private readonly providers: Map<string, IssuingProvider>) {}

  register(name: string, provider: IssuingProvider): void {
    this.providers.set(name, provider);
  }

  get(name: string): IssuingProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new IssuingProviderNotFoundError(name);
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
