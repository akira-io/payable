import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import { Money } from '../../../domain/value-objects/money';
import { assertDecimalCurrency } from '../assert-decimal-currency';

export function paddleMoney(amount: number, currency: string): Money {
  const code = currency.toUpperCase();
  if (!CurrencyManager.supports(code)) {
    throw new PayableError(`Paddle currency ${code} is not supported`, {
      code: 'PROVIDER_CURRENCY_UNSUPPORTED',
      context: { currency: code },
    });
  }
  assertDecimalCurrency('Paddle', code);
  return Money.of(amount, code);
}

export function paddleAmount(money: Money): string {
  assertDecimalCurrency('Paddle', money.currency());
  return String(money.amount());
}
