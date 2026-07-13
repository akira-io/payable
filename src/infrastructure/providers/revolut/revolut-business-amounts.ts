import { CurrencyManager } from '../../../domain/value-objects/currency';
import { Money } from '../../../domain/value-objects/money';
import { assertDecimalCurrency } from '../assert-decimal-currency';

export function revolutBusinessAmount(money: Money): number {
  assertDecimalCurrency('Revolut Business', money.currency());
  const exponent = CurrencyManager.precision(money.currency());
  return money.amount() / 10 ** exponent;
}

export function revolutBusinessMoney(majorAmount: number, currency: string): Money {
  assertDecimalCurrency('Revolut Business', currency);
  if (!Number.isFinite(majorAmount)) {
    throw new TypeError(`Revolut Business amount must be finite, got ${majorAmount}`);
  }
  const exponent = CurrencyManager.precision(currency);
  return Money.of(Math.round(majorAmount * 10 ** exponent), currency);
}
