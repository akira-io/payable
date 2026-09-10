import { describe, expect, it } from 'vitest';
import { CurrencyConverter } from '../src/application/services/currency/currency-converter';
import { ExchangeRateNotFoundError } from '../src/domain/errors/exchange-rate-not-found.error';
import { Money } from '../src/domain/value-objects/money';
import { FixedExchangeRateProvider } from '../src/infrastructure/exchange/fixed-exchange-rate-provider';

function converter(table: Record<string, string> = { 'EUR/CVE': '110.265' }): CurrencyConverter {
  return new CurrencyConverter(new FixedExchangeRateProvider(table));
}

describe('CurrencyConverter', () => {
  it('converts the checkout that was charged as escudos', async () => {
    const result = await converter().convert(Money.of(2500, 'EUR'), 'CVE');
    expect(result.converted.currency()).toBe('CVE');
    expect(result.converted.amount()).toBe(275_663);
    expect(result.source.amount()).toBe(2500);
    expect(result.rate.rate).toBe('110.265');
  });

  it('passes through when the currencies match, without rounding', async () => {
    const money = Money.of(2500, 'EUR');
    const result = await converter().convert(money, 'eur');
    expect(result.converted).toBe(money);
    expect(result.source).toBe(money);
    expect(result.rate.rate).toBe('1');
    expect(result.rate.from).toBe('EUR');
    expect(result.rate.to).toBe('EUR');
  });

  it('throws instead of returning the unconverted amount', async () => {
    await expect(converter().convert(Money.of(2500, 'CVE'), 'EUR')).rejects.toBeInstanceOf(
      ExchangeRateNotFoundError,
    );
  });

  it('rounds an exact half away from zero', async () => {
    const half = converter({ 'EUR/CVE': '1.005' });
    expect((await half.convert(Money.of(1, 'EUR'), 'CVE')).converted.amount()).toBe(1);
    expect((await half.convert(Money.of(100, 'EUR'), 'CVE')).converted.amount()).toBe(101);
    expect((await half.convert(Money.of(-100, 'EUR'), 'CVE')).converted.amount()).toBe(-101);
  });

  it('rescales between currencies with different exponents', async () => {
    const toJpy = converter({ 'EUR/JPY': '160.5' });
    const result = await toJpy.convert(Money.of(2500, 'EUR'), 'JPY');
    expect(result.converted.currency()).toBe('JPY');
    expect(result.converted.amount()).toBe(4013);
  });

  it('rescales upwards when the target has more decimals', async () => {
    const fromJpy = converter({ 'JPY/EUR': '0.0062' });
    const result = await fromJpy.convert(Money.of(4013, 'JPY'), 'EUR');
    expect(result.converted.amount()).toBe(2488);
  });

  it('keeps precision on an intermediate product a float cannot represent exactly', async () => {
    const result = await converter().convert(Money.of(5_252_117_401_598, 'EUR'), 'CVE');
    expect(result.converted.amount()).toBe(579_124_725_287_203);
  });

  it('refuses a result outside the safe integer range', async () => {
    const huge = converter({ 'EUR/CVE': '10000000' });
    await expect(huge.convert(Money.of(9_007_199_254, 'EUR'), 'CVE')).rejects.toThrow(
      /safe integer range/,
    );
  });

  it('rescales correctly against a base-5 minor unit', async () => {
    const toMga = converter({ 'EUR/MGA': '4900' });
    const result = await toMga.convert(Money.of(2500, 'EUR'), 'MGA');
    expect(result.converted.currency()).toBe('MGA');
    expect(result.converted.amount()).toBe(612_500);
  });

  it('carries the provenance into the serialized result', async () => {
    const result = await converter().convert(Money.of(2500, 'EUR'), 'CVE');
    expect(result.toJSON()).toEqual({
      source: { amount: 2500, currency: 'EUR' },
      converted: { amount: 275_663, currency: 'CVE' },
      rate: { from: 'EUR', to: 'CVE', rate: '110.265' },
    });
  });
});
