import { describe, expect, it } from 'vitest';
import { FixedExchangeRateProvider } from '../src/infrastructure/exchange/fixed-exchange-rate-provider';

describe('FixedExchangeRateProvider', () => {
  it('resolves a configured pair', async () => {
    const provider = new FixedExchangeRateProvider({ 'EUR/CVE': '110.265' });
    const rate = await provider.rateFor('EUR', 'CVE');
    expect(rate?.rate).toBe('110.265');
    expect(rate?.from).toBe('EUR');
    expect(rate?.to).toBe('CVE');
  });

  it('does not derive the inverse pair', async () => {
    const provider = new FixedExchangeRateProvider({ 'EUR/CVE': '110.265' });
    await expect(provider.rateFor('CVE', 'EUR')).resolves.toBeUndefined();
  });

  it('resolves an unknown pair to undefined', async () => {
    const provider = new FixedExchangeRateProvider({ 'EUR/CVE': '110.265' });
    await expect(provider.rateFor('USD', 'CVE')).resolves.toBeUndefined();
  });

  it('normalizes the codes on both sides of the lookup', async () => {
    const provider = new FixedExchangeRateProvider({ 'eur/cve': '110.265' });
    await expect(provider.rateFor('eur', 'CVE')).resolves.toBeDefined();
  });

  it('rejects a malformed pair key at construction', () => {
    expect(() => new FixedExchangeRateProvider({ EURCVE: '110.265' })).toThrow(TypeError);
    expect(() => new FixedExchangeRateProvider({ 'EUR/CVE/USD': '110.265' })).toThrow(TypeError);
  });

  it('rejects an invalid rate at construction', () => {
    expect(() => new FixedExchangeRateProvider({ 'EUR/CVE': '0' })).toThrow(RangeError);
  });

  it('rejects an unsupported currency code instead of resolving to undefined', async () => {
    const provider = new FixedExchangeRateProvider({ 'EUR/CVE': '110.265' });
    await expect(provider.rateFor('EUR', 'XXX')).rejects.toThrow(RangeError);
  });
});
