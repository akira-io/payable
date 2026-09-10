import { describe, expect, it } from 'vitest';
import { ExchangeRateNotFoundError } from '../src/domain/errors/exchange-rate-not-found.error';
import { ExchangeRate } from '../src/domain/value-objects/exchange-rate';

describe('ExchangeRate', () => {
  it('decomposes a decimal rate into an exact bigint fraction', () => {
    const rate = ExchangeRate.of('EUR', 'CVE', '110.265');
    expect(rate.numerator).toBe(110_265n);
    expect(rate.denominator).toBe(1000n);
    expect(rate.rate).toBe('110.265');
  });

  it('normalizes the currency codes', () => {
    const rate = ExchangeRate.of('eur', 'cve', '1');
    expect(rate.from).toBe('EUR');
    expect(rate.to).toBe('CVE');
  });

  it('accepts a rate too small for a number literal to round-trip exactly', () => {
    const rate = ExchangeRate.of('EUR', 'CVE', '0.0000000073');
    expect(rate.numerator).toBe(73n);
    expect(rate.denominator).toBe(10n ** 10n);
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
    expect(() => ExchangeRate.of('EUR', 'CVE', '0')).toThrow(RangeError);
    expect(() => ExchangeRate.of('EUR', 'CVE', '0.000')).toThrow(RangeError);
    expect(() => ExchangeRate.of('EUR', 'CVE', '-1')).toThrow(TypeError);
    expect(() => ExchangeRate.of('EUR', 'CVE', 'NaN')).toThrow(TypeError);
    expect(() => ExchangeRate.of('EUR', 'CVE', 'Infinity')).toThrow(TypeError);
    expect(() => ExchangeRate.of('EUR', 'CVE', '1e-7')).toThrow(TypeError);
  });

  it('rejects unsupported currency codes', () => {
    expect(() => ExchangeRate.of('EUR', 'XYZ', '1')).toThrow(RangeError);
  });

  it('rejects a rate whose decimal text exceeds the length bound', () => {
    const longest = `1.${'0'.repeat(38)}`;
    expect(longest.length).toBe(40);
    expect(() => ExchangeRate.of('EUR', 'CVE', longest)).not.toThrow();
    const tooLong = `1.${'0'.repeat(39)}`;
    expect(() => ExchangeRate.of('EUR', 'CVE', tooLong)).toThrow(RangeError);
  });

  it('serializes the pair and the rate text', () => {
    expect(ExchangeRate.of('EUR', 'CVE', '110.265').toJSON()).toEqual({
      from: 'EUR',
      to: 'CVE',
      rate: '110.265',
    });
  });
});

describe('ExchangeRateNotFoundError', () => {
  it('names the pair it could not resolve', () => {
    const error = new ExchangeRateNotFoundError('EUR', 'CVE');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('EXCHANGE_RATE_NOT_FOUND');
    expect(error.message).toBe('Exchange rate not found for EUR to CVE');
    expect(error.context).toEqual({ from: 'EUR', to: 'CVE' });
  });
});
