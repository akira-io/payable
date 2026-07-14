import type { IdentityProvider } from './domain/contracts/identity-provider.contract';
import { IdentityProviderNotFoundError } from './domain/errors/identity-provider-not-found.error';

export class IdentityProviderRegistry {
  constructor(private readonly providers: Map<string, IdentityProvider>) {}

  register(name: string, provider: IdentityProvider): void {
    this.providers.set(name, provider);
  }

  get(name: string): IdentityProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new IdentityProviderNotFoundError(name);
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
