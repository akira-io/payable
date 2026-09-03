import type { CurrencyCode } from '../value-objects/currency';
import type { PaymentStatus } from '../value-objects/payment-status';
import type { TenantScoped, Timestamps } from './common';

export interface Payment extends TenantScoped, Timestamps {
  readonly id: string;
  readonly customerId: string | null;
  readonly provider: string | null;
  readonly providerPaymentId: string | null;
  readonly status: PaymentStatus;
  readonly currency: CurrencyCode;
  readonly amount: number;
  readonly refundedAmount: number;
  readonly capturedAmount: number;
  readonly authorizedAt: Date | null;
  readonly authorizationExpiresAt: Date | null;
  readonly reference: string | null;
  readonly description: string | null;
  readonly collectionMethod: CollectionMethod | null;
  readonly occurredAt: Date | null;
  readonly externalReference: string | null;
  readonly recordedBy: string | null;
}

export type CollectionMethod =
  | 'cash'
  | 'bank_transfer'
  | 'cheque'
  | 'money_order'
  | 'mobile_money'
  | 'card_terminal'
  | 'other';
