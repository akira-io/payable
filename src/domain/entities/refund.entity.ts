import type { CurrencyCode } from '../value-objects/currency';
import type { RefundStatus } from '../value-objects/refund-status';
import type { TenantScoped, Timestamps } from './common';

export interface Refund extends TenantScoped, Timestamps {
  readonly id: string;
  readonly paymentId: string;
  readonly provider: string;
  readonly providerRefundId: string | null;
  readonly status: RefundStatus;
  readonly currency: CurrencyCode;
  readonly amount: number;
  readonly reason: string | null;
}
