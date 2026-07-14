import type { Money } from '../value-objects/money';

export type MarketplaceCapability = 'accounts' | 'onboarding' | 'transfers' | 'payouts';
export type MarketplaceCapabilityValue = MarketplaceCapability | (string & {});
export type MarketplaceCapabilities = ReadonlySet<MarketplaceCapabilityValue>;
export type MarketplaceAccountStatus = 'pending' | 'active' | 'restricted' | 'disabled' | 'unknown';
export type MarketplaceTransferStatus = 'pending' | 'completed' | 'failed' | 'reversed' | 'unknown';
export type MarketplacePayoutStatus = 'pending' | 'paid' | 'failed' | 'canceled' | 'unknown';

export interface CreateMarketplaceAccountInput {
  type: 'individual' | 'business';
  country: string;
  email: string;
  reference?: string;
}

export interface MarketplaceAccountDTO {
  providerAccountId: string;
  type: 'individual' | 'business';
  country: string;
  email: string | null;
  status: MarketplaceAccountStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: string[];
  createdAt: Date | null;
}

export interface ListMarketplaceAccountsInput {
  status?: MarketplaceAccountStatus;
  limit?: number;
}

export interface CreateMarketplaceOnboardingLinkInput {
  providerAccountId: string;
  refreshUrl: string;
  returnUrl: string;
}

export interface MarketplaceOnboardingLinkDTO {
  providerAccountId: string;
  url: string;
  expiresAt: Date | null;
}

export interface CreateMarketplaceTransferInput {
  destinationProviderAccountId: string;
  amount: Money;
  reference?: string;
}

export interface MarketplaceTransferDTO {
  providerTransferId: string;
  destinationProviderAccountId: string;
  amount: Money;
  status: MarketplaceTransferStatus;
  createdAt: Date | null;
}

export interface ListMarketplaceTransfersInput {
  destinationProviderAccountId?: string;
  limit?: number;
}

export interface CreateMarketplacePayoutInput {
  providerAccountId: string;
  amount: Money;
  reference?: string;
}

export interface ListMarketplacePayoutsInput {
  providerAccountId: string;
  limit?: number;
}

export interface MarketplacePayoutDTO {
  providerPayoutId: string;
  providerAccountId: string;
  amount: Money;
  status: MarketplacePayoutStatus;
  arrivalAt: Date | null;
  createdAt: Date | null;
}
