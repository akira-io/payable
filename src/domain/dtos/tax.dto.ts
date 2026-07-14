import type { Money } from '../value-objects/money';

export type TaxCapability = 'calculations' | 'transactions';
export type TaxCapabilityValue = TaxCapability | (string & {});
export type TaxCapabilities = ReadonlySet<TaxCapabilityValue>;

export type TaxCalculationStatus = 'pending' | 'complete' | 'failed' | 'unknown';

export interface TaxAddressDTO {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
}

export interface TaxLineItemInput {
  reference: string;
  amount: Money;
  quantity: number;
  taxCode?: string;
}

export interface CalculateTaxInput {
  customerAddress: TaxAddressDTO;
  lineItems: TaxLineItemInput[];
  shipping?: Money;
  customerTaxIds?: string[];
}

export interface TaxCalculationDTO {
  providerCalculationId: string;
  status: TaxCalculationStatus;
  subtotal: Money;
  tax: Money;
  total: Money;
  expiresAt: Date | null;
}

export interface CommitTaxTransactionInput {
  providerCalculationId: string;
  reference: string;
}

export interface ReverseTaxTransactionInput {
  providerTransactionId: string;
  reference: string;
}

export type TaxTransactionStatus = 'committed' | 'reversed' | 'failed' | 'unknown';

export interface TaxTransactionDTO {
  providerTransactionId: string;
  reference: string;
  status: TaxTransactionStatus;
  createdAt: Date | null;
}
