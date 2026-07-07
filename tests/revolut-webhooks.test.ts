import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidWebhookSignatureError } from '../src/domain/errors/invalid-webhook-signature.error';
import { RevolutProvider } from '../src/infrastructure/providers/revolut/revolut-provider';

function signature(payload: string, timestamp: string, secret = 'wsk_test'): string {
  const value = createHmac('sha256', secret).update(`v1.${timestamp}.${payload}`).digest('hex');
  return `v1=${value}`;
}

function provider() {
  return new RevolutProvider({ secretKey: 'sk_rev_test', webhookSecret: 'wsk_test' });
}

describe('RevolutProvider webhooks', () => {
  it('verifies a Revolut webhook signature and normalizes payment events', async () => {
    const payload = JSON.stringify({ event: 'ORDER_COMPLETED', order_id: 'ord_1' });
    const timestamp = String(Date.now());
    const verified = await provider().verifyWebhook({
      payload,
      signature: signature(payload, timestamp),
      headers: { 'Revolut-Request-Timestamp': timestamp },
    });

    expect(verified).toEqual({
      providerEventId: `revolut_${createHash('sha256').update(payload).digest('hex')}`,
      type: 'ORDER_COMPLETED',
      normalizedType: 'payment.succeeded',
      data: { event: 'ORDER_COMPLETED', order_id: 'ord_1' },
    });
  });

  it('rejects Revolut webhooks with an invalid signature', async () => {
    const payload = JSON.stringify({ event: 'ORDER_COMPLETED', order_id: 'ord_1' });
    await expect(
      provider().verifyWebhook({
        payload,
        signature: 'v1=bad',
        headers: { 'Revolut-Request-Timestamp': String(Date.now()) },
      }),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it('reconciles verified Revolut payment webhooks by order id', () => {
    expect(
      provider().reconcilePayment({
        providerEventId: 'evt_1',
        type: 'ORDER_COMPLETED',
        normalizedType: 'payment.succeeded',
        data: { event: 'ORDER_COMPLETED', order_id: 'ord_1' },
      }),
    ).toEqual({ providerPaymentId: 'ord_1', status: 'succeeded' });
    expect(
      provider().reconcilePayment({
        providerEventId: 'evt_2',
        type: 'ORDER_PAYMENT_FAILED',
        normalizedType: 'payment.failed',
        data: { event: 'ORDER_PAYMENT_FAILED', order_id: 'ord_1' },
      }),
    ).toEqual({ providerPaymentId: 'ord_1', status: 'failed' });
    expect(
      provider().reconcilePayment({
        providerEventId: 'evt_3',
        type: 'ORDER_CANCELLED',
        normalizedType: null,
        data: { event: 'ORDER_CANCELLED', order_id: 'ord_1' },
      }),
    ).toEqual({ providerPaymentId: 'ord_1', status: 'canceled' });
    expect(
      provider().reconcilePayment({
        providerEventId: 'evt_4',
        type: 'PAYOUT_COMPLETED',
        normalizedType: null,
        data: { event: 'PAYOUT_COMPLETED', payout_id: 'po_1' },
      }),
    ).toBeNull();
  });

  it('reconciles Revolut subscription cancellation webhooks', () => {
    expect(
      provider().reconcileSubscription({
        providerEventId: 'evt_1',
        type: 'SUBSCRIPTION_CANCELLED',
        normalizedType: 'subscription.cancelled',
        data: { event: 'SUBSCRIPTION_CANCELLED', subscription_id: 'sub_1' },
      }),
    ).toEqual({
      providerSubscriptionId: 'sub_1',
      status: 'canceled',
      currentPeriodEnd: null,
      trialEndsAt: null,
    });
  });
});
