import type { OperationContext } from '../dtos/common.dto';
import type {
  CreateMarketplaceAccountInput,
  CreateMarketplaceOnboardingLinkInput,
  CreateMarketplacePayoutInput,
  CreateMarketplaceTransferInput,
  ListMarketplaceAccountsInput,
  ListMarketplacePayoutsInput,
  ListMarketplaceTransfersInput,
  MarketplaceAccountDTO,
  MarketplaceCapabilities,
  MarketplaceOnboardingLinkDTO,
  MarketplacePayoutDTO,
  MarketplaceTransferDTO,
} from '../dtos/marketplace.dto';

export interface MarketplaceProvider {
  readonly name: string;
  capabilities(): MarketplaceCapabilities;
}

export interface MarketplaceAccountCapable {
  createMarketplaceAccount(
    input: CreateMarketplaceAccountInput,
    ctx: OperationContext,
  ): Promise<MarketplaceAccountDTO>;
  retrieveMarketplaceAccount(providerAccountId: string): Promise<MarketplaceAccountDTO>;
  listMarketplaceAccounts(input?: ListMarketplaceAccountsInput): Promise<MarketplaceAccountDTO[]>;
}

export interface MarketplaceOnboardingCapable {
  createMarketplaceOnboardingLink(
    input: CreateMarketplaceOnboardingLinkInput,
    ctx: OperationContext,
  ): Promise<MarketplaceOnboardingLinkDTO>;
}

export interface MarketplaceTransferCapable {
  createMarketplaceTransfer(
    input: CreateMarketplaceTransferInput,
    ctx: OperationContext,
  ): Promise<MarketplaceTransferDTO>;
  listMarketplaceTransfers(
    input?: ListMarketplaceTransfersInput,
  ): Promise<MarketplaceTransferDTO[]>;
  retrieveMarketplaceTransfer(providerTransferId: string): Promise<MarketplaceTransferDTO>;
}

export interface MarketplacePayoutCapable {
  createMarketplacePayout(
    input: CreateMarketplacePayoutInput,
    ctx: OperationContext,
  ): Promise<MarketplacePayoutDTO>;
  listMarketplacePayouts(input: ListMarketplacePayoutsInput): Promise<MarketplacePayoutDTO[]>;
  retrieveMarketplacePayout(
    providerAccountId: string,
    providerPayoutId: string,
  ): Promise<MarketplacePayoutDTO>;
}

export function isMarketplaceAccountCapable(
  provider: MarketplaceProvider,
): provider is MarketplaceProvider & MarketplaceAccountCapable {
  const candidate = provider as Partial<MarketplaceAccountCapable>;
  return (
    typeof candidate.createMarketplaceAccount === 'function' &&
    typeof candidate.retrieveMarketplaceAccount === 'function' &&
    typeof candidate.listMarketplaceAccounts === 'function'
  );
}

export function isMarketplaceOnboardingCapable(
  provider: MarketplaceProvider,
): provider is MarketplaceProvider & MarketplaceOnboardingCapable {
  return (
    typeof (provider as Partial<MarketplaceOnboardingCapable>).createMarketplaceOnboardingLink ===
    'function'
  );
}

export function isMarketplaceTransferCapable(
  provider: MarketplaceProvider,
): provider is MarketplaceProvider & MarketplaceTransferCapable {
  const candidate = provider as Partial<MarketplaceTransferCapable>;
  return (
    typeof candidate.createMarketplaceTransfer === 'function' &&
    typeof candidate.listMarketplaceTransfers === 'function' &&
    typeof candidate.retrieveMarketplaceTransfer === 'function'
  );
}

export function isMarketplacePayoutCapable(
  provider: MarketplaceProvider,
): provider is MarketplaceProvider & MarketplacePayoutCapable {
  const candidate = provider as Partial<MarketplacePayoutCapable>;
  return (
    typeof candidate.createMarketplacePayout === 'function' &&
    typeof candidate.listMarketplacePayouts === 'function' &&
    typeof candidate.retrieveMarketplacePayout === 'function'
  );
}
