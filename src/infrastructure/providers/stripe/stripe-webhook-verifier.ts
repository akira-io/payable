import type Stripe from 'stripe';
import { InvalidWebhookSignatureError } from '../../../domain/errors/invalid-webhook-signature.error';

export interface StripeWebhookEventRecord {
  id: string;
  type: string;
  created: number;
  data: { object?: unknown };
}

export class StripeWebhookVerifier {
  constructor(private readonly secret: string) {}

  async verify(
    stripe: unknown,
    payload: string,
    signature: string,
  ): Promise<StripeWebhookEventRecord> {
    const client = stripe as Stripe;
    try {
      const event = await client.webhooks.constructEventAsync(payload, signature, this.secret);
      return event as StripeWebhookEventRecord;
    } catch (error) {
      throw new InvalidWebhookSignatureError('stripe', { cause: error });
    }
  }
}
