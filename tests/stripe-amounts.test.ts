import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import {
  stripeAmount,
  stripeCurrencyExponent,
  stripeMoney,
} from '../src/infrastructure/providers/stripe/stripe-amounts';

describe('stripeCurrencyExponent', () => {
  it('classifies zero, two and three decimal currencies', () => {
    expect(stripeCurrencyExponent('JPY')).toBe(0);
    expect(stripeCurrencyExponent('usd')).toBe(2);
    expect(stripeCurrencyExponent('KWD')).toBe(3);
  });
});

describe('stripeMoney', () => {
  it('builds money when the Stripe exponent matches the domain exponent', () => {
    expect(stripeMoney(500, 'JPY').amount()).toBe(500);
    expect(stripeMoney(1099, 'usd').amount()).toBe(1099);
    expect(stripeMoney(1500, 'KWD').amount()).toBe(1500);
  });

  it('rescales between a divergent Stripe and domain exponent instead of throwing', () => {
    // ISK: Stripe exponent 2, domain exponent 0 -> divide the read amount by 100.
    expect(stripeMoney(100000, 'ISK').amount()).toBe(1000);
    // Write direction multiplies back up to the Stripe exponent.
    expect(stripeAmount(Money.of(1000, 'ISK'))).toBe(100000);
  });

  it('throws only when a down-rescale would lose precision', () => {
    expect(() => stripeMoney(150, 'ISK')).toThrow(/precision loss/);
  });
});
