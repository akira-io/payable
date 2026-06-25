import { describe, expect, it } from 'vitest';
import { CurrencyManager } from '../src/domain/value-objects/currency';
import { Money } from '../src/domain/value-objects/money';
import { paddleAmount, paddleMoney } from '../src/infrastructure/providers/paddle/paddle-amounts';
import { sispAmount, sispDecimal } from '../src/infrastructure/providers/sisp/sisp-amounts';
import { stripeAmount } from '../src/infrastructure/providers/stripe/stripe-amounts';

describe('decimal currency guard', () => {
  it('flags base-5 currencies as non-decimal', () => {
    expect(CurrencyManager.isDecimalBase('MGA')).toBe(false);
    expect(CurrencyManager.isDecimalBase('MRU')).toBe(false);
    expect(CurrencyManager.isDecimalBase('USD')).toBe(true);
    expect(CurrencyManager.isDecimalBase('JPY')).toBe(true);
  });

  it('rejects base-5 currencies at provider amount boundaries', () => {
    const mga = Money.of(5, 'MGA');
    expect(() => stripeAmount(mga)).toThrowError(/base-10/);
    expect(() => sispAmount(mga)).toThrowError(/base-10/);
    expect(() => sispDecimal(mga)).toThrowError(/base-10/);
    expect(() => paddleMoney(5, 'MGA')).toThrowError(/base-10/);
    expect(() => paddleAmount(mga)).toThrowError(/base-10/);
  });

  it('still accepts base-10 currencies', () => {
    expect(() => stripeAmount(Money.of(1000, 'USD'))).not.toThrow();
    expect(() => sispDecimal(Money.of(1500, 'CVE'))).not.toThrow();
    expect(() => paddleMoney(1000, 'USD')).not.toThrow();
    expect(paddleAmount(Money.of(1000, 'USD'))).toBe('1000');
  });
});
