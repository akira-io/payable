import { describe, expect, it } from 'vitest';
import { StripeEventNormalizer } from '../src/infrastructure/providers/stripe/stripe-event-normalizer';

describe('StripeEventNormalizer', () => {
  it('normalizes successful invoice payment events as paid invoices', () => {
    const normalizer = new StripeEventNormalizer();

    expect(normalizer.normalize('invoice.payment_succeeded')).toBe('invoice.paid');
  });
});
