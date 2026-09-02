import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import {
  trustMyTravelAmount,
  trustMyTravelMoney,
} from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-amounts';

describe('Trust My Travel amounts', () => {
  it('serializes two-decimal Money as integer minor units', () => {
    expect(trustMyTravelAmount(Money.of(9999, 'EUR'))).toBe(9999);
    expect(trustMyTravelAmount(Money.of(1050, 'USD'))).toBe(1050);
  });

  it('deserializes integer minor units without floating-point conversion', () => {
    const money = trustMyTravelMoney(9999, 'eur');

    expect(money.amount()).toBe(9999);
    expect(money.currency()).toBe('EUR');
  });

  it.each([
    ['JPY', 0],
    ['KWD', 3],
  ])('rejects %s with exponent %i in both conversion directions', (currency, exponent) => {
    const expectedError = {
      code: 'PROVIDER_CURRENCY_EXPONENT_UNSUPPORTED',
      context: {
        provider: 'trust-my-travel',
        currency,
        exponent,
        requiredExponent: 2,
      },
    };

    expect(() => trustMyTravelAmount(Money.of(100, currency))).toThrowError(
      expect.objectContaining(expectedError),
    );
    expect(() => trustMyTravelMoney(100, currency)).toThrowError(
      expect.objectContaining(expectedError),
    );
  });
});
