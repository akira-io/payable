import { describe, expect, it } from 'vitest';
import {
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
});
