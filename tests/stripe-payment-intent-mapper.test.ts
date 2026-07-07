import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import type { PaymentStatus } from '../src/domain/value-objects/payment-status';
import { toChargeResultDTO } from '../src/infrastructure/providers/stripe/stripe-mappers';

describe('stripe payment intent mapper', () => {
  it('maps every official payment intent status to a domain status', () => {
    const statusMap: Record<Stripe.PaymentIntent.Status, PaymentStatus> = {
      succeeded: 'succeeded',
      processing: 'processing',
      canceled: 'canceled',
      requires_payment_method: 'pending',
      requires_confirmation: 'pending',
      requires_action: 'pending',
      requires_capture: 'pending',
    };

    for (const [stripeStatus, domainStatus] of Object.entries(statusMap)) {
      const dto = toChargeResultDTO({
        id: `pi_${stripeStatus}`,
        status: stripeStatus,
        amount: 100,
        currency: 'usd',
      } as Stripe.PaymentIntent);

      expect(dto.status).toBe(domainStatus);
    }
  });
});
