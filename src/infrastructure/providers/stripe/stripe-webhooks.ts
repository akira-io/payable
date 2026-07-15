import type Stripe from 'stripe';
import type { Logger } from '../../../domain/contracts/logger.contract';
import type { PaymentWebhookReconciliation } from '../../../domain/contracts/payment-provider.contract';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import type { VerifiedWebhook, WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { assertSubscriptionPayload } from '../webhook-subscription-payload';
import { StripeEventNormalizer } from './stripe-event-normalizer';
import { toSubscriptionDTOFromWebhook } from './stripe-mappers';
import { reconcileStripePaymentWebhook } from './stripe-payment-webhook-reconciliation';
import { StripeWebhookVerifier } from './stripe-webhook-verifier';

export class StripeWebhooks {
  private readonly verifier: StripeWebhookVerifier;
  private readonly normalizer: StripeEventNormalizer;

  constructor(
    private readonly client: () => Promise<Stripe>,
    webhookSecret: string,
    logger?: Logger,
  ) {
    this.verifier = new StripeWebhookVerifier(webhookSecret);
    this.normalizer = new StripeEventNormalizer(logger);
  }

  async verify(input: WebhookVerificationInput): Promise<VerifiedWebhook> {
    const stripe = await this.client();
    const event = await this.verifier.verify(stripe, input.payload, input.signature);
    return {
      providerEventId: event.id,
      type: event.type,
      normalizedType: this.normalizer.normalize(event.type),
      occurredAt: typeof event.created === 'number' ? new Date(event.created * 1000) : null,
      data: (event.data.object ?? {}) as unknown as Record<string, unknown>,
    };
  }

  reconcileSubscription(verified: VerifiedWebhook): SubscriptionDTO | null {
    if (!verified.normalizedType?.startsWith('subscription.')) {
      return null;
    }
    assertSubscriptionPayload(verified.data, 'stripe');
    return toSubscriptionDTOFromWebhook(verified.data);
  }

  reconcilePayment(verified: VerifiedWebhook): PaymentWebhookReconciliation | null {
    return reconcileStripePaymentWebhook(verified);
  }
}
