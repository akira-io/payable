import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import { Money } from '../../../domain/value-objects/money';

const REQUIRED_CURRENCY_EXPONENT = 2;

function assertTrustMyTravelCurrencyExponent(currency: string): string {
  const code = CurrencyManager.normalize(currency);
  const exponent = CurrencyManager.precision(code);

  if (exponent !== REQUIRED_CURRENCY_EXPONENT) {
    throw new PayableError(
      `Trust My Travel cannot process currency ${code} with exponent ${exponent}`,
      {
        code: 'PROVIDER_CURRENCY_EXPONENT_UNSUPPORTED',
        context: {
          provider: 'trust-my-travel',
          currency: code,
          exponent,
          requiredExponent: REQUIRED_CURRENCY_EXPONENT,
        },
      },
    );
  }

  return code;
}

export function trustMyTravelAmount(money: Money): number {
  assertTrustMyTravelCurrencyExponent(money.currency());
  return money.amount();
}

export function trustMyTravelMoney(amount: number, currency: string): Money {
  const code = assertTrustMyTravelCurrencyExponent(currency);
  return Money.of(amount, code);
}
