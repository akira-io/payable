import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { InvalidWebhookSignatureError } from '../src/domain/errors/invalid-webhook-signature.error';
import { StripeWebhookVerifier } from '../src/infrastructure/providers/stripe/stripe-webhook-verifier';

const secret = 'whsec_test_secret_value';
const stripe = new Stripe('sk_test_123');
const verifier = new StripeWebhookVerifier(secret);
const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });

describe('StripeWebhookVerifier with real signatures', () => {
  it('accepts a correctly signed payload', async () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const event = await verifier.verify(stripe, payload, header);
    expect(event.id).toBe('evt_1');
  });

  it('rejects a tampered payload signed for the original body', async () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    await expect(verifier.verify(stripe, `${payload} `, header)).rejects.toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });

  it('rejects a payload signed with the wrong secret', async () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_other' });
    await expect(verifier.verify(stripe, payload, header)).rejects.toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });
});
