import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import {
  isPaymentWebhookCapable,
  type PaymentProvider,
  type PaymentWebhookCapable,
} from '../src/domain/contracts/payment-provider.contract';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

function provider(): PaymentProvider & PaymentWebhookCapable {
  const subject = new StripeProvider(
    { secretKey: 'sk_test', webhookSecret: 'wh_test' },
    {} as Stripe,
  );
  if (!isPaymentWebhookCapable(subject)) {
    throw new Error('StripeProvider must implement PaymentWebhookCapable');
  }
  return subject;
}

describe('StripeProvider payment webhook reconciliation', () => {
  it('maps payment intent events to local payment reconciliation', () => {
    const dto = provider().reconcilePayment({
      providerEventId: 'evt_pi',
      type: 'payment_intent.succeeded',
      normalizedType: 'payment.succeeded',
      data: { id: 'pi_1' },
    });

    expect(dto).toEqual({ providerPaymentId: 'pi_1', status: 'succeeded' });
  });

  it('maps charge events through the related payment intent id', () => {
    const dto = provider().reconcilePayment({
      providerEventId: 'evt_charge',
      type: 'charge.failed',
      normalizedType: 'payment.failed',
      data: { id: 'ch_1', payment_intent: 'pi_2' },
    });

    expect(dto).toEqual({ providerPaymentId: 'pi_2', status: 'failed' });
  });

  it('maps paid checkout session events through the session id', () => {
    const dto = provider().reconcilePayment({
      providerEventId: 'evt_checkout',
      type: 'checkout.session.completed',
      normalizedType: 'checkout.completed',
      data: { id: 'cs_1', payment_status: 'paid' },
    });

    expect(dto).toEqual({ providerPaymentId: 'cs_1', status: 'succeeded' });
  });

  it('ignores checkout sessions that do not represent a paid payment', () => {
    const dto = provider().reconcilePayment({
      providerEventId: 'evt_checkout_pending',
      type: 'checkout.session.completed',
      normalizedType: 'checkout.completed',
      data: { id: 'cs_2', payment_status: 'unpaid' },
    });

    expect(dto).toBeNull();
  });

  it('maps failed asynchronous checkout session events through the session id', () => {
    const dto = provider().reconcilePayment({
      providerEventId: 'evt_checkout_failed',
      type: 'checkout.session.async_payment_failed',
      normalizedType: 'payment.failed',
      data: { id: 'cs_failed' },
    });

    expect(dto).toEqual({ providerPaymentId: 'cs_failed', status: 'failed' });
  });

  it('ignores non-payment events and malformed payment payloads', () => {
    expect(
      provider().reconcilePayment({
        providerEventId: 'evt_subscription',
        type: 'customer.subscription.updated',
        normalizedType: 'subscription.updated',
        data: { id: 'sub_1' },
      }),
    ).toBeNull();
    expect(
      provider().reconcilePayment({
        providerEventId: 'evt_charge_without_intent',
        type: 'charge.succeeded',
        normalizedType: 'payment.succeeded',
        data: { id: 'ch_2' },
      }),
    ).toBeNull();
  });
});
