import {
  add,
  type Dinero,
  dinero,
  equal,
  greaterThan,
  lessThan,
  multiply,
  subtract,
  toDecimal,
  toSnapshot,
} from 'dinero.js';
import { type CurrencyCode, CurrencyManager } from './currency';

function divideMinor(amount: number, divisor: number): number {
  if (divisor === 0) {
    throw new RangeError('Cannot divide money by zero');
  }
  const sign = Math.sign(amount) * Math.sign(divisor);
  const a = Math.abs(amount);
  const d = Math.abs(divisor);
  const quotient = Math.trunc(a / d);
  const remainder = a - quotient * d;
  const rounded = remainder * 2 >= d ? quotient + 1 : quotient;
  return sign * rounded;
}

export class Money {
  private constructor(
    private readonly value: Dinero<number>,
    private readonly code: CurrencyCode,
  ) {}

  static of(minorAmount: number, currency: CurrencyCode): Money {
    if (!Number.isInteger(minorAmount)) {
      throw new TypeError(`Money amount must be an integer in minor units, got ${minorAmount}`);
    }
    const resolved = CurrencyManager.resolve(currency);
    return new Money(dinero({ amount: minorAmount, currency: resolved }), resolved.code);
  }

  amount(): number {
    return toSnapshot(this.value).amount;
  }

  currency(): CurrencyCode {
    return this.code;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(add(this.value, other.value), this.code);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(subtract(this.value, other.value), this.code);
  }

  multiply(factor: number): Money {
    if (!Number.isInteger(factor)) {
      throw new TypeError(`Money multiplier must be an integer, got ${factor}`);
    }
    return new Money(multiply(this.value, factor), this.code);
  }

  divide(divisor: number): Money {
    if (!Number.isInteger(divisor)) {
      throw new TypeError(`Money divisor must be an integer, got ${divisor}`);
    }
    return Money.of(divideMinor(this.amount(), divisor), this.code);
  }

  allocate(ratios: number[]): Money[] {
    if (ratios.length === 0) {
      throw new RangeError('allocate requires at least one ratio');
    }
    if (ratios.some((ratio) => ratio < 0)) {
      throw new RangeError('allocate ratios cannot be negative');
    }
    const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
    if (total <= 0) {
      throw new RangeError('allocate ratios must sum to a positive value');
    }
    const amount = this.amount();
    const shares = ratios.map((ratio) => Math.trunc((amount * ratio) / total));
    let remainder = amount - shares.reduce((sum, share) => sum + share, 0);
    const step = remainder >= 0 ? 1 : -1;
    let index = 0;
    while (remainder !== 0) {
      shares[index] = (shares[index] ?? 0) + step;
      remainder -= step;
      index = (index + 1) % shares.length;
    }
    return shares.map((share) => Money.of(share, this.code));
  }

  equals(other: Money): boolean {
    return this.code === other.code && equal(this.value, other.value);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return greaterThan(this.value, other.value);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return lessThan(this.value, other.value);
  }

  isZero(): boolean {
    return this.amount() === 0;
  }

  isNegative(): boolean {
    return this.amount() < 0;
  }

  format(locale = 'en-US'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.code,
    }).format(Number(toDecimal(this.value)));
  }

  toJSON(): { amount: number; currency: CurrencyCode } {
    return { amount: this.amount(), currency: this.code };
  }

  private assertSameCurrency(other: Money): void {
    if (this.code !== other.code) {
      throw new TypeError(`Currency mismatch: ${this.code} vs ${other.code}`);
    }
  }
}
