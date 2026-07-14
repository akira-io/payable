import type { AccountingProvider } from './domain/contracts/accounting-provider.contract';
import { AccountingProviderNotFoundError } from './domain/errors/accounting-provider-not-found.error';

export class AccountingProviderRegistry {
  constructor(private readonly providers: Map<string, AccountingProvider>) {}

  register(name: string, provider: AccountingProvider): void {
    this.providers.set(name, provider);
  }

  get(name: string): AccountingProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new AccountingProviderNotFoundError(name);
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
