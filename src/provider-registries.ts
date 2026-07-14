import { AccountingProviderRegistry } from './accounting-provider-registry';
import { IdentityProviderRegistry } from './identity-provider-registry';
import { IssuingProviderRegistry } from './issuing-provider-registry';
import { MarketplaceProviderRegistry } from './marketplace-provider-registry';
import { ProviderRegistry } from './provider-registry';
import type { ResolvedConfig } from './support/config/payable-config';
import { TaxProviderRegistry } from './tax-provider-registry';
import { TerminalProviderRegistry } from './terminal-provider-registry';
import { TreasuryProviderRegistry } from './treasury-provider-registry';

export class ProviderRegistries {
  protected readonly registry: ProviderRegistry;
  protected readonly treasuryRegistry: TreasuryProviderRegistry;
  private readonly accountingRegistry: AccountingProviderRegistry;
  private readonly identityRegistry: IdentityProviderRegistry;
  private readonly issuingRegistry: IssuingProviderRegistry;
  private readonly marketplaceRegistry: MarketplaceProviderRegistry;
  private readonly taxRegistry: TaxProviderRegistry;
  private readonly terminalRegistry: TerminalProviderRegistry;

  constructor(resolved: ResolvedConfig) {
    this.registry = new ProviderRegistry(resolved.providers);
    this.accountingRegistry = new AccountingProviderRegistry(resolved.accountingProviders);
    this.identityRegistry = new IdentityProviderRegistry(resolved.identityProviders);
    this.issuingRegistry = new IssuingProviderRegistry(resolved.issuingProviders);
    this.marketplaceRegistry = new MarketplaceProviderRegistry(resolved.marketplaceProviders);
    this.taxRegistry = new TaxProviderRegistry(resolved.taxProviders);
    this.terminalRegistry = new TerminalProviderRegistry(resolved.terminalProviders);
    this.treasuryRegistry = new TreasuryProviderRegistry(resolved.treasuryProviders);
  }

  providers(): ProviderRegistry {
    return this.registry;
  }

  accountingProviders(): AccountingProviderRegistry {
    return this.accountingRegistry;
  }

  identityProviders(): IdentityProviderRegistry {
    return this.identityRegistry;
  }

  issuingProviders(): IssuingProviderRegistry {
    return this.issuingRegistry;
  }

  marketplaceProviders(): MarketplaceProviderRegistry {
    return this.marketplaceRegistry;
  }

  taxProviders(): TaxProviderRegistry {
    return this.taxRegistry;
  }

  terminalProviders(): TerminalProviderRegistry {
    return this.terminalRegistry;
  }

  treasuryProviders(): TreasuryProviderRegistry {
    return this.treasuryRegistry;
  }
}
