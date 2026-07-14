import { describe, expect, it } from 'vitest';
import {
  mapStripeIssuingAuthorization,
  mapStripeIssuingCard,
  mapStripeIssuingCardholder,
  mapStripeIssuingTransaction,
} from '../src/infrastructure/providers/stripe/stripe-issuing-mappers';
import {
  stripeCardholder,
  stripeIssuingAuthorization,
  stripeIssuingCard,
  stripeIssuingTransaction,
} from './support/stripe-issuing';

describe('Stripe Issuing mappers', () => {
  it('maps only non-sensitive card display fields', () => {
    const mapped = mapStripeIssuingCard(stripeIssuingCard());
    const serialized = JSON.stringify(mapped);

    expect(mapped).toEqual({
      providerCardId: 'ic_1',
      providerCardholderId: 'ich_1',
      form: 'virtual',
      status: 'active',
      brand: 'Visa',
      lastFour: '4242',
      expiryMonth: 12,
      expiryYear: 2030,
      createdAt: new Date(1_725_000_100_000),
    });
    expect(serialized).not.toContain('4242424242424242');
    expect(serialized).not.toContain('123');
    expect(serialized).not.toMatch(/number|cvc|pin/i);
  });

  it('maps expanded and identifier card relationships safely', () => {
    expect(mapStripeIssuingCard(stripeIssuingCard()).providerCardholderId).toBe('ich_1');
    expect(
      mapStripeIssuingCard(stripeIssuingCard({ cardholder: 'ich_2' as never }))
        .providerCardholderId,
    ).toBe('ich_2');
    expect(
      mapStripeIssuingTransaction(stripeIssuingTransaction({ card: stripeIssuingCard() }))
        .providerCardId,
    ).toBe('ic_1');
  });

  it('maps cardholder and card lifecycle states', () => {
    expect(mapStripeIssuingCardholder(stripeCardholder({ type: 'company' })).type).toBe('business');
    expect(
      mapStripeIssuingCardholder(stripeCardholder({ status: 'future_state' as never })).status,
    ).toBe('unknown');
    expect(mapStripeIssuingCard(stripeIssuingCard({ status: 'canceled' })).status).toBe('canceled');
    expect(mapStripeIssuingCard(stripeIssuingCard({ status: 'inactive' })).status).toBe('inactive');
  });

  it('maps authorization status, amount, and merchant', () => {
    const pending = mapStripeIssuingAuthorization(stripeIssuingAuthorization());
    const declined = mapStripeIssuingAuthorization(
      stripeIssuingAuthorization({ approved: false, status: 'closed' }),
    );
    const reversed = mapStripeIssuingAuthorization(
      stripeIssuingAuthorization({ approved: true, status: 'reversed' }),
    );

    expect(pending.status).toBe('approved');
    expect(pending.amount.amount()).toBe(1500);
    expect(pending.amount.currency().toString()).toBe('USD');
    expect(pending.merchantName).toBe('Example Store');
    expect(declined.status).toBe('declined');
    expect(reversed.status).toBe('reversed');
  });

  it('maps capture and refund transactions without provider objects', () => {
    const capture = mapStripeIssuingTransaction(stripeIssuingTransaction());
    const refund = mapStripeIssuingTransaction(
      stripeIssuingTransaction({ amount: 500, type: 'refund' }),
    );

    expect(capture.type).toBe('capture');
    expect(capture.amount.amount()).toBe(-1500);
    expect(refund.type).toBe('refund');
    expect(JSON.stringify(refund)).not.toMatch(/merchant_data|balance_transaction/i);
  });
});
