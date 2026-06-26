import type { CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import type { RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type { Money } from '../../../domain/value-objects/money';
import type { PaymentStatus } from '../../../domain/value-objects/payment-status';
import type { RefundStatus } from '../../../domain/value-objects/refund-status';
import type { SispTransactionRecord } from './sisp-types';

const PAYMENT_STATUS_BY_TRANSACTION: Record<string, PaymentStatus> = {
  pending: 'pending',
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'canceled',
  refunded: 'refunded',
};

const REFUND_STATUS_BY_TRANSACTION: Record<string, RefundStatus> = {
  pending: 'pending',
  failed: 'failed',
  cancelled: 'canceled',
  completed: 'succeeded',
  refunded: 'succeeded',
};

export function toPaymentStatus(transactionStatus: string): PaymentStatus {
  return PAYMENT_STATUS_BY_TRANSACTION[transactionStatus] ?? 'pending';
}

export function toRefundStatus(transactionStatus: string): RefundStatus {
  return REFUND_STATUS_BY_TRANSACTION[transactionStatus] ?? 'pending';
}

export function toCheckoutSessionDTO(
  merchantRef: string,
  gatewayUrl: string,
  html: string,
): CheckoutSessionDTO {
  return { id: merchantRef, url: gatewayUrl, html };
}

export function toRefundResultDTO(
  transaction: SispTransactionRecord,
  amount: Money,
): RefundResultDTO {
  return {
    providerRefundId: transaction.transaction_id ?? String(transaction.id),
    status: toRefundStatus(transaction.status),
    amount,
  };
}
