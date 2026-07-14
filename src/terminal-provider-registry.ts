import type { TerminalProvider } from './domain/contracts/terminal-provider.contract';
import { TerminalProviderNotFoundError } from './domain/errors/terminal-provider-not-found.error';

export class TerminalProviderRegistry {
  constructor(private readonly providers: Map<string, TerminalProvider>) {}

  register(name: string, provider: TerminalProvider): void {
    this.providers.set(name, provider);
  }

  get(name: string): TerminalProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new TerminalProviderNotFoundError(name);
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
