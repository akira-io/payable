import { describe, expect, it } from 'vitest';
import { ExchangeRate } from '../src/domain/value-objects/exchange-rate';

describe('ExchangeRate', () => {
  it('decomposes a decimal rate into an exact bigint fraction', () => {
    const rate = ExchangeRate.of('EUR', 'CVE', '110.265');
    expect(rate.numerator).toBe(110_265n);
    expect(rate.denominator).toBe(1000n);
    expect(rate.rate).toBe('110.265');
  });

  it('normalizes the currency codes', () => {
    const rate = ExchangeRate.of('eur', 'cve', 1);
    expect(rate.from).toBe('EUR');
    expect(rate.to).toBe('CVE');
  });

  it('accepts a number and keeps its decimal representation', () => {
    const rate = ExchangeRate.of('EUR', 'CVE', 110.265);
    expect(rate.rate).toBe('110.265');
    expect(rate.numerator).toBe(110_265n);
    expect(rate.denominator).toBe(1000n);
  });

  it('builds an identity rate for a single currency', () => {
    const rate = ExchangeRate.identity('CVE');
    expect(rate.from).toBe('CVE');
    expect(rate.to).toBe('CVE');
    expect(rate.rate).toBe('1');
    expect(rate.numerator).toBe(1n);
    expect(rate.denominator).toBe(1n);
  });

  it('rejects rates that are not positive decimals', () => {
    expect(() => ExchangeRate.of('EUR', 'CVE', 0)).toThrow(RangeError);
    expect(() => ExchangeRate.of('EUR', 'CVE', '0.000')).toThrow(RangeError);
    expect(() => ExchangeRate.of('EUR', 'CVE', -1)).toThrow(TypeError);
    expect(() => ExchangeRate.of('EUR', 'CVE', Number.NaN)).toThrow(TypeError);
    expect(() => ExchangeRate.of('EUR', 'CVE', Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => ExchangeRate.of('EUR', 'CVE', '1e-7')).toThrow(TypeError);
    expect(() => ExchangeRate.of('EUR', 'CVE', 0.0000001)).toThrow(TypeError);
  });

  it('rejects unsupported currency codes', () => {
    expect(() => ExchangeRate.of('EUR', 'XYZ', 1)).toThrow(RangeError);
  });

  it('serializes the pair and the rate text', () => {
    expect(ExchangeRate.of('EUR', 'CVE', '110.265').toJSON()).toEqual({
      from: 'EUR',
      to: 'CVE',
      rate: '110.265',
    });
  });
});
