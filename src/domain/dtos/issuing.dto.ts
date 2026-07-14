import type { Money } from '../value-objects/money';

export type IssuingCapability = 'cardholders' | 'cards' | 'authorizations' | 'transactions';
export type IssuingCapabilityValue = IssuingCapability | (string & {});
export type IssuingCapabilities = ReadonlySet<IssuingCapabilityValue>;

export type IssuingCardStatus = 'active' | 'inactive' | 'blocked' | 'canceled' | 'unknown';
export type IssuingCardholderStatus = 'active' | 'inactive' | 'unknown';
export type IssuingAuthorizationStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'reversed'
  | 'unknown';
export type IssuingTransactionType = 'capture' | 'refund' | 'reversal' | 'unknown';

export interface IssuingAddressDTO {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
}

export interface IssuingShippingDTO {
  name: string;
  phone?: string;
  address: IssuingAddressDTO;
}

export interface CreateIssuingCardholderInput {
  type: 'individual' | 'business';
  name: string;
  email?: string;
  phone?: string;
  billingAddress?: IssuingAddressDTO;
  reference?: string;
}

export interface IssuingCardholderDTO {
  providerCardholderId: string;
  type: 'individual' | 'business';
  name: string;
  email: string | null;
  status: IssuingCardholderStatus;
  createdAt: Date | null;
}

export interface CreateIssuingCardInput {
  providerCardholderId?: string;
  holderReference?: string;
  form: 'virtual' | 'physical';
  label?: string;
  currency?: string;
  shipping?: IssuingShippingDTO;
  spendingLimit?: Money;
}

export interface IssuingCardDTO {
  providerCardId: string;
  providerCardholderId: string | null;
  form: 'virtual' | 'physical';
  status: IssuingCardStatus;
  brand: string | null;
  lastFour: string;
  expiryMonth: number | null;
  expiryYear: number | null;
  createdAt: Date | null;
}

export interface ListIssuingCardsInput {
  providerCardholderId?: string;
  status?: IssuingCardStatus;
  limit?: number;
}

export interface IssuingAuthorizationDTO {
  providerAuthorizationId: string;
  providerCardId: string;
  amount: Money;
  status: IssuingAuthorizationStatus;
  merchantName: string | null;
  createdAt: Date | null;
}

export interface ListIssuingAuthorizationsInput {
  providerCardId?: string;
  status?: IssuingAuthorizationStatus;
  limit?: number;
}

export interface RespondIssuingAuthorizationInput {
  providerAuthorizationId: string;
  decision: 'approve' | 'decline';
}

export interface IssuingTransactionDTO {
  providerTransactionId: string;
  providerCardId: string;
  amount: Money;
  type: IssuingTransactionType;
  createdAt: Date | null;
}

export interface ListIssuingTransactionsInput {
  providerCardId?: string;
  providerAuthorizationId?: string;
  limit?: number;
}
