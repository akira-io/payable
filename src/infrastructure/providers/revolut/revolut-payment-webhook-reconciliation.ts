import type { PaymentWebhookReconciliation } from '../../../domain/contracts/payment-provider.contract';
import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import type { PaymentStatus } from '../../../domain/value-objects/payment-status';

const STATUS_BY_EVENT: Record<string, PaymentStatus> = {
  ORDER_COMPLETED: 'succeeded',
  ORDER_FAILED: 'failed',
  ORDER_PAYMENT_DECLINED: 'failed',
  ORDER_PAYMENT_FAILED: 'failed',
  ORDER_CANCELLED: 'canceled',
};

export function reconcileRevolutPaymentWebhook(
  verified: VerifiedWebhook,
): PaymentWebhookReconciliation | null {
  const event = typeof verified.data.event === 'string' ? verified.data.event : verified.type;
  const orderId = typeof verified.data.order_id === 'string' ? verified.data.order_id : null;
  const status = STATUS_BY_EVENT[event];
  if (!orderId || !status) {
    return null;
  }
  return { providerPaymentId: orderId, status };
}
