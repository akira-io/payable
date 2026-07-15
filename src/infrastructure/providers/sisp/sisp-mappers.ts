import type { CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import type { PaymentStatus } from '../../../domain/value-objects/payment-status';

const PAYMENT_STATUS_BY_TRANSACTION: Record<string, PaymentStatus> = {
  pending: 'pending',
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'canceled',
  refunded: 'refunded',
};

export function toPaymentStatus(transactionStatus: string): PaymentStatus {
  return PAYMENT_STATUS_BY_TRANSACTION[transactionStatus] ?? 'pending';
}

export function toCheckoutSessionDTO(
  merchantRef: string,
  gatewayUrl: string,
  html: string,
): CheckoutSessionDTO {
  return { id: merchantRef, url: gatewayUrl, html };
}
