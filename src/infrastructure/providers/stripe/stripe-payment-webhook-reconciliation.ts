import type { PaymentWebhookReconciliation } from '../../../domain/contracts/payment-provider.contract';
import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';

export function reconcileStripePaymentWebhook(
  verified: VerifiedWebhook,
): PaymentWebhookReconciliation | null {
  switch (verified.type) {
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed':
      return reconcilePaymentIntentWebhook(verified);
    case 'charge.succeeded':
    case 'charge.failed':
      return reconcileChargeWebhook(verified);
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed':
      return reconcileCheckoutSessionWebhook(verified);
    default:
      return null;
  }
}

function reconcilePaymentIntentWebhook(
  verified: VerifiedWebhook,
): PaymentWebhookReconciliation | null {
  const providerPaymentId = stringValue(verified.data.id);
  const status = paymentStatus(verified);
  if (!providerPaymentId || !status) {
    return null;
  }
  return { providerPaymentId, status };
}

function reconcileChargeWebhook(verified: VerifiedWebhook): PaymentWebhookReconciliation | null {
  const providerPaymentId = paymentIntentId(verified.data.payment_intent);
  const status = paymentStatus(verified);
  if (!providerPaymentId || !status) {
    return null;
  }
  return { providerPaymentId, status };
}

function reconcileCheckoutSessionWebhook(
  verified: VerifiedWebhook,
): PaymentWebhookReconciliation | null {
  const providerPaymentId = stringValue(verified.data.id);
  if (!providerPaymentId) {
    return null;
  }
  if (verified.type === 'checkout.session.async_payment_failed') {
    return { providerPaymentId, status: 'failed' };
  }
  if (verified.type === 'checkout.session.async_payment_succeeded') {
    return { providerPaymentId, status: 'succeeded' };
  }
  if (verified.data.payment_status !== 'paid') {
    return null;
  }
  return { providerPaymentId, status: 'succeeded' };
}

function paymentStatus(verified: VerifiedWebhook): PaymentWebhookReconciliation['status'] | null {
  if (verified.normalizedType === 'payment.succeeded') {
    return 'succeeded';
  }
  if (verified.normalizedType === 'payment.failed') {
    return 'failed';
  }
  return null;
}

function paymentIntentId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return stringValue((value as { id?: unknown }).id);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
