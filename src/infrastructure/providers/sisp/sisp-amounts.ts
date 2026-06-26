import { CurrencyManager } from '../../../domain/value-objects/currency';
import { Money } from '../../../domain/value-objects/money';
import { assertDecimalCurrency } from '../assert-decimal-currency';

export function sispAmount(money: Money): number {
  assertDecimalCurrency('SISP', money.currency());
  const exponent = CurrencyManager.precision(money.currency());
  return money.amount() / 10 ** exponent;
}

export function sispDecimal(money: Money): string {
  assertDecimalCurrency('SISP', money.currency());
  const exponent = CurrencyManager.precision(money.currency());
  const minor = money.amount();
  if (exponent === 0) {
    return String(minor);
  }
  const negative = minor < 0;
  const digits = Math.abs(minor)
    .toString()
    .padStart(exponent + 1, '0');
  const units = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${units}.${fraction}`;
}

export function sispMoney(majorAmount: number, currency: string): Money {
  assertDecimalCurrency('SISP', currency);
  const exponent = CurrencyManager.precision(currency);
  return Money.of(Math.round(majorAmount * 10 ** exponent), currency);
}
