import { describe, expect, it } from 'vitest';
import { CurrencyManager, type KnownCurrencyCode } from '../src/domain/value-objects/currency';

describe('CurrencyManager', () => {
  it('returns ISO decimal precision per currency', () => {
    expect(CurrencyManager.precision('USD')).toBe(2);
    expect(CurrencyManager.precision('EUR')).toBe(2);
    expect(CurrencyManager.precision('JPY')).toBe(0);
  });

  it('supports known currencies case-insensitively', () => {
    expect(CurrencyManager.supports('usd')).toBe(true);
    expect(CurrencyManager.supports('ZZZ')).toBe(false);
  });

  it('normalizes to the canonical code', () => {
    expect(CurrencyManager.normalize('eur')).toBe('EUR');
  });

  it('throws on unsupported currencies', () => {
    expect(() => CurrencyManager.resolve('ZZZ')).toThrow(RangeError);
  });

  it('exposes a KnownCurrencyCode type covering ISO codes', () => {
    const code: KnownCurrencyCode = 'USD';
    expect(CurrencyManager.supports(code)).toBe(true);
  });
});
