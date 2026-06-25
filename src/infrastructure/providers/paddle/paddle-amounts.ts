import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import { Money } from '../../../domain/value-objects/money';

export function paddleMoney(amount: number, currency: string): Money {
  const code = currency.toUpperCase();
  if (!CurrencyManager.supports(code)) {
    throw new PayableError(`Paddle currency ${code} is not supported`, {
      code: 'PROVIDER_CURRENCY_UNSUPPORTED',
      context: { currency: code },
    });
  }
  return Money.of(amount, code);
}
