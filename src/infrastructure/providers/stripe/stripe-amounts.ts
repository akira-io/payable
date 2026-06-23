import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import { Money } from '../../../domain/value-objects/money';

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

export function stripeMoney(amount: number, currency: string): Money {
  const code = currency.toUpperCase();
  const providerExponent = stripeCurrencyExponent(code);
  const domainExponent = CurrencyManager.precision(code);
  if (providerExponent !== domainExponent) {
    throw new PayableError(
      `Stripe currency ${code} exponent ${providerExponent} does not match the domain exponent ${domainExponent}`,
      {
        code: 'PROVIDER_CURRENCY_EXPONENT_MISMATCH',
        context: { currency: code, providerExponent, domainExponent },
      },
    );
  }
  return Money.of(amount, code);
}
