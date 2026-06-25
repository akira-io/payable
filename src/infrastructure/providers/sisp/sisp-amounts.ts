import { CurrencyManager } from '../../../domain/value-objects/currency';
import { Money } from '../../../domain/value-objects/money';

export function sispAmount(money: Money): number {
  const exponent = CurrencyManager.precision(money.currency());
  return money.amount() / 10 ** exponent;
}

export function sispMoney(majorAmount: number, currency: string): Money {
  const exponent = CurrencyManager.precision(currency);
  return Money.of(Math.round(majorAmount * 10 ** exponent), currency);
}
