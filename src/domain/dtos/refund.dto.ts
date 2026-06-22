import type { Money } from '../value-objects/money';
import type { RefundStatus } from '../value-objects/refund-status';

export interface RefundInput {
  providerPaymentId: string;
  amount?: Money;
  reason?: string;
}

export interface RefundResultDTO {
  providerRefundId: string;
  status: RefundStatus;
  amount: Money;
}
