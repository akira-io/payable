import type { CurrencyCode } from '../value-objects/currency';
import type { PaymentStatus } from '../value-objects/payment-status';
import type { TenantScoped, Timestamps } from './common';

export interface Payment extends TenantScoped, Timestamps {
  readonly id: string;
  readonly customerId: string | null;
  readonly provider: string;
  readonly providerPaymentId: string | null;
  readonly status: PaymentStatus;
  readonly currency: CurrencyCode;
  readonly amount: number;
  readonly refundedAmount: number;
  readonly reference: string | null;
  readonly description: string | null;
}
