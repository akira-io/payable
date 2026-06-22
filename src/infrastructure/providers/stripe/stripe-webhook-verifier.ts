import type Stripe from 'stripe';
import { InvalidWebhookSignatureError } from '../../../domain/errors/invalid-webhook-signature.error';

export class StripeWebhookVerifier {
  constructor(private readonly secret: string) {}

  async verify(stripe: Stripe, payload: string, signature: string): Promise<Stripe.Event> {
    try {
      return await stripe.webhooks.constructEventAsync(payload, signature, this.secret);
    } catch (error) {
      throw new InvalidWebhookSignatureError('stripe', { cause: error });
    }
  }
}
