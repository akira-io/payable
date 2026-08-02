import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { toInvoiceDTO as toStripeInvoiceDTO } from '../src/infrastructure/providers/stripe/stripe-mappers';

describe('stripe invoice mapping', () => {
  it('treats a missing total as zero rather than throwing', () => {
    const dto = toStripeInvoiceDTO({
      id: 'in_1',
      status: 'draft',
      total: null,
      currency: 'usd',
    } as unknown as Stripe.Invoice);
    expect(dto.total.amount()).toBe(0);
  });

  it('passes a known invoice status through', () => {
    const dto = toStripeInvoiceDTO({
      id: 'in_2',
      status: 'open',
      total: 9900,
      currency: 'usd',
    } as unknown as Stripe.Invoice);
    expect(dto.status).toBe('open');
  });

  it('falls back to draft for an unmodeled provider status instead of casting a lie', () => {
    const dto = toStripeInvoiceDTO({
      id: 'in_3',
      status: 'deleted',
      total: 0,
      currency: 'usd',
    } as unknown as Stripe.Invoice);
    expect(dto.status).toBe('draft');
  });
});
