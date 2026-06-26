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
import { type CurrencyCode, type CurrencyInput, CurrencyManager } from './currency';

function assertSafeMinor(amount: number, context: string): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(
      `Money ${context} (${amount}) exceeds the safe integer range; values beyond 2^53-1 lose precision`,
    );
  }
}

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

const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

function divideMinorBig(amount: bigint, divisor: bigint): number {
  if (divisor === 0n) {
    throw new RangeError('Cannot divide money by zero');
  }
  const sign = (amount < 0n ? -1n : 1n) * (divisor < 0n ? -1n : 1n);
  const a = amount < 0n ? -amount : amount;
  const d = divisor < 0n ? -divisor : divisor;
  const quotient = a / d;
  const remainder = a - quotient * d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  const signed = sign * rounded;
  if (signed > MAX_SAFE_MINOR || signed < -MAX_SAFE_MINOR) {
    throw new RangeError(
      `Money percentage (${signed}) exceeds the safe integer range; values beyond 2^53-1 lose precision`,
    );
  }
  return Number(signed);
}

export class Money {
  private constructor(
    private readonly value: Dinero<number>,
    private readonly code: CurrencyCode,
  ) {}

  static of(minorAmount: number, currency: CurrencyInput): Money {
    if (!Number.isInteger(minorAmount)) {
      throw new TypeError(`Money amount must be an integer in minor units, got ${minorAmount}`);
    }
    assertSafeMinor(minorAmount, 'amount');
    const resolved = CurrencyManager.resolve(currency);
    return new Money(dinero({ amount: minorAmount, currency: resolved }), resolved.code);
  }

  amount(): number {
    const snapshot = toSnapshot(this.value);
    const exponent = CurrencyManager.precision(this.code);
    if (snapshot.scale !== exponent) {
      throw new RangeError(
        `Money scale ${snapshot.scale} does not match the ${this.code} exponent ${exponent}`,
      );
    }
    return snapshot.amount;
  }

  currency(): CurrencyCode {
    return this.code;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    assertSafeMinor(this.amount() + other.amount(), 'sum');
    return new Money(add(this.value, other.value), this.code);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    assertSafeMinor(this.amount() - other.amount(), 'difference');
    return new Money(subtract(this.value, other.value), this.code);
  }

  multiply(factor: number): Money {
    if (!Number.isInteger(factor)) {
      throw new TypeError(`Money multiplier must be an integer, got ${factor}`);
    }
    assertSafeMinor(this.amount() * factor, 'product');
    return new Money(multiply(this.value, factor), this.code);
  }

  divide(divisor: number): Money {
    if (!Number.isInteger(divisor)) {
      throw new TypeError(`Money divisor must be an integer, got ${divisor}`);
    }
    return Money.of(divideMinor(this.amount(), divisor), this.code);
  }

  percentage(basisPoints: number): Money {
    if (!Number.isInteger(basisPoints)) {
      throw new TypeError(`Basis points must be an integer, got ${basisPoints}`);
    }
    const result = divideMinorBig(BigInt(this.amount()) * BigInt(basisPoints), 10_000n);
    return Money.of(result, this.code);
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
    const shares = ratios.map((ratio) => {
      assertSafeMinor(amount * ratio, 'allocation product');
      return Math.trunc((amount * ratio) / total);
    });
    const eligible = ratios.reduce<number[]>((indices, ratio, index) => {
      if (ratio > 0) {
        indices.push(index);
      }
      return indices;
    }, []);
    let remainder = amount - shares.reduce((sum, share) => sum + share, 0);
    const step = remainder >= 0 ? 1 : -1;
    let cursor = 0;
    while (remainder !== 0) {
      const target = eligible[cursor % eligible.length] ?? 0;
      shares[target] = (shares[target] ?? 0) + step;
      remainder -= step;
      cursor += 1;
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
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.code,
    });
    const formatValue = formatter.format as (value: string | number) => string;
    return CurrencyManager.isDecimalBase(this.code)
      ? formatValue(toDecimal(this.value))
      : formatValue(this.nonDecimalUnits());
  }

  private nonDecimalUnits(): number {
    const { base, exponent } = CurrencyManager.resolve(this.code);
    const divisor = Array.isArray(base)
      ? base.reduce((unit, value) => unit * value, 1)
      : base ** exponent;
    return this.amount() / divisor;
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
