import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import { Money } from '../../../domain/value-objects/money';
import { assertDecimalCurrency } from '../assert-decimal-currency';

const STRIPE_ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

const STRIPE_THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

export function stripeCurrencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (STRIPE_ZERO_DECIMAL.has(code)) {
    return 0;
  }
  if (STRIPE_THREE_DECIMAL.has(code)) {
    return 3;
  }
  return 2;
}

function rescale(amount: number, fromExponent: number, toExponent: number, code: string): number {
  const diff = toExponent - fromExponent;
  if (diff === 0) {
    return amount;
  }
  if (diff > 0) {
    return amount * 10 ** diff;
  }
  const factor = 10 ** -diff;
  if (amount % factor !== 0) {
    throw new PayableError(
      `Stripe currency ${code} amount ${amount} cannot be rescaled from exponent ${fromExponent} to ${toExponent} without precision loss`,
      {
        code: 'PROVIDER_CURRENCY_EXPONENT_MISMATCH',
        context: { currency: code, fromExponent, toExponent, amount },
      },
    );
  }
  return amount / factor;
}

export function stripeMoney(amount: number, currency: string): Money {
  const code = currency.toUpperCase();
  assertDecimalCurrency('Stripe', code);
  const rescaled = rescale(
    amount,
    stripeCurrencyExponent(code),
    CurrencyManager.precision(code),
    code,
  );
  return Money.of(rescaled, code);
}

export function stripeAmount(money: Money): number {
  const code = money.currency().toUpperCase();
  assertDecimalCurrency('Stripe', code);
  return rescale(
    money.amount(),
    CurrencyManager.precision(code),
    stripeCurrencyExponent(code),
    code,
  );
}
