import { describe, expect, it } from 'vitest';
import { CurrencyManager } from '../src/domain/value-objects/currency';
import { Money } from '../src/domain/value-objects/money';

describe('Money', () => {
  it('stores amounts in minor units', () => {
    expect(Money.of(1099, 'USD').amount()).toBe(1099);
    expect(Money.of(2550, 'EUR').amount()).toBe(2550);
    expect(Money.of(1000, 'JPY').amount()).toBe(1000);
  });

  it('exposes the normalized currency code', () => {
    expect(Money.of(1099, 'eur').currency()).toBe('EUR');
  });

  it('rejects non-integer minor amounts', () => {
    expect(() => Money.of(10.99, 'USD')).toThrow(TypeError);
  });

  it('adds and subtracts within the same currency', () => {
    const total = Money.of(1099, 'EUR').add(Money.of(100, 'EUR'));
    expect(total.amount()).toBe(1199);
    expect(Money.of(1099, 'EUR').subtract(Money.of(99, 'EUR')).amount()).toBe(1000);
  });

  it('throws on currency mismatch', () => {
    expect(() => Money.of(100, 'USD').add(Money.of(100, 'EUR'))).toThrow('Currency mismatch');
  });

  it('multiplies by an integer factor', () => {
    expect(Money.of(1099, 'EUR').multiply(3).amount()).toBe(3297);
  });

  it('divides using half-up rounding without floating point', () => {
    expect(Money.of(1000, 'USD').divide(3).amount()).toBe(333);
    expect(Money.of(1001, 'USD').divide(2).amount()).toBe(501);
    expect(Money.of(-1001, 'USD').divide(2).amount()).toBe(-501);
  });

  it('rejects division by zero', () => {
    expect(() => Money.of(100, 'USD').divide(0)).toThrow(RangeError);
  });

  it('compares amounts', () => {
    const a = Money.of(200, 'USD');
    const b = Money.of(100, 'USD');
    expect(a.isGreaterThan(b)).toBe(true);
    expect(b.isLessThan(a)).toBe(true);
    expect(a.equals(Money.of(200, 'USD'))).toBe(true);
    expect(a.equals(b)).toBe(false);
  });

  it('reports zero and negative amounts', () => {
    expect(Money.of(0, 'USD').isZero()).toBe(true);
    expect(Money.of(-1, 'USD').isNegative()).toBe(true);
  });

  it('formats with the currency symbol and precision', () => {
    expect(Money.of(1099, 'USD').format()).toBe('$10.99');
    expect(Money.of(1000, 'JPY').format()).toBe('¥1,000');
  });

  it('serializes to amount and currency', () => {
    expect(Money.of(1099, 'EUR').toJSON()).toEqual({ amount: 1099, currency: 'EUR' });
  });

  it('allocates an amount across ratios conserving the total', () => {
    const shares = Money.of(100, 'USD').allocate([1, 1, 1]);
    expect(shares.map((s) => s.amount())).toEqual([34, 33, 33]);
    expect(shares.reduce((sum, s) => sum + s.amount(), 0)).toBe(100);
  });

  it('allocates by weight and keeps every minor unit', () => {
    const shares = Money.of(1000, 'USD').allocate([1, 3]);
    expect(shares.map((s) => s.amount())).toEqual([250, 750]);
  });

  it('allocates a negative amount conserving sign and total', () => {
    const shares = Money.of(-100, 'USD').allocate([1, 1, 1]);
    expect(shares.map((s) => s.amount())).toEqual([-34, -33, -33]);
    expect(shares.reduce((sum, s) => sum + s.amount(), 0)).toBe(-100);
  });

  it('rejects invalid allocation ratios', () => {
    expect(() => Money.of(100, 'USD').allocate([])).toThrow(RangeError);
    expect(() => Money.of(100, 'USD').allocate([0, 0])).toThrow(RangeError);
    expect(() => Money.of(100, 'USD').allocate([1, -1])).toThrow(RangeError);
  });

  it('keeps the snapshot scale aligned with the currency exponent through operations', () => {
    expect(Money.of(1000, 'USD').multiply(3).amount()).toBe(3000);
    expect(Money.of(1000, 'USD').divide(3).amount()).toBe(333);
    const shares = Money.of(1000, 'USD').allocate([1, 1, 1]);
    expect(shares.reduce((sum, m) => sum + m.amount(), 0)).toBe(1000);
  });

  it('computes a percentage in basis points with half-up rounding', () => {
    expect(Money.of(10_000, 'USD').percentage(1200).amount()).toBe(1200);
    expect(Money.of(105, 'USD').percentage(1000).amount()).toBe(11);
    expect(() => Money.of(100, 'USD').percentage(12.5)).toThrow(TypeError);
  });

  it('rejects amounts beyond the safe integer range', () => {
    expect(() => Money.of(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow(RangeError);
  });

  it('rejects multiply and percentage products that overflow the safe integer range', () => {
    const large = Money.of(90_000_000_000, 'JPY');
    expect(() => large.multiply(1_000_000)).toThrow(RangeError);
    expect(() => large.percentage(1_000_000)).toThrow(RangeError);
  });

  it('treats minor units correctly for zero-decimal currencies', () => {
    const yen = Money.of(1000, 'JPY');
    expect(yen.amount()).toBe(1000);
    expect(yen.currency()).toBe('JPY');
    expect(CurrencyManager.precision('JPY')).toBe(0);
    expect(yen.add(Money.of(500, 'JPY')).amount()).toBe(1500);
  });
});
