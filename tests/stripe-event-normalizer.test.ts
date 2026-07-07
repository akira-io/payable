import { describe, expect, it } from 'vitest';
import { StripeEventNormalizer } from '../src/infrastructure/providers/stripe/stripe-event-normalizer';

describe('StripeEventNormalizer', () => {
  it('normalizes successful invoice payment events as paid invoices', () => {
    const normalizer = new StripeEventNormalizer();

    expect(normalizer.normalize('invoice.payment_succeeded')).toBe('invoice.paid');
  });

  it('normalizes successful asynchronous checkout payment events as completed checkouts', () => {
    const normalizer = new StripeEventNormalizer();

    expect(normalizer.normalize('checkout.session.async_payment_succeeded')).toBe(
      'checkout.completed',
    );
  });

  it('normalizes failed asynchronous checkout payment events as failed payments', () => {
    const normalizer = new StripeEventNormalizer();

    expect(normalizer.normalize('checkout.session.async_payment_failed')).toBe('payment.failed');
  });

  it('normalizes charge payment outcome events as payment outcomes', () => {
    const normalizer = new StripeEventNormalizer();

    expect(normalizer.normalize('charge.succeeded')).toBe('payment.succeeded');
    expect(normalizer.normalize('charge.failed')).toBe('payment.failed');
  });
});
