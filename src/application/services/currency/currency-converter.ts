import type { ExchangeRateProvider } from '../../../domain/contracts/exchange-rate-provider.contract';
import { ExchangeRateNotFoundError } from '../../../domain/errors/exchange-rate-not-found.error';
import {
  type CurrencyCode,
  type CurrencyInput,
  CurrencyManager,
} from '../../../domain/value-objects/currency';
import { CurrencyConversion } from '../../../domain/value-objects/currency-conversion';
import { ExchangeRate } from '../../../domain/value-objects/exchange-rate';
import { divideMinorBig } from '../../../domain/value-objects/minor-units';
import { Money } from '../../../domain/value-objects/money';

export class CurrencyConverter {
  constructor(private readonly rates: ExchangeRateProvider) {}

  async convert(money: Money, to: CurrencyInput): Promise<CurrencyConversion> {
    const source = money.currency();
    const target = CurrencyManager.normalize(to);
    if (source === target) {
      return new CurrencyConversion(money, money, ExchangeRate.identity(source));
    }
    const rate = await this.rates.rateFor(source, target);
    if (rate === undefined) {
      throw new ExchangeRateNotFoundError(source, target);
    }
    return new CurrencyConversion(money, Money.of(applyRate(money, rate, target), target), rate);
  }
}

function applyRate(money: Money, rate: ExchangeRate, target: CurrencyCode): number {
  const shift = CurrencyManager.precision(target) - CurrencyManager.precision(money.currency());
  const numerator = rate.numerator * 10n ** BigInt(Math.max(shift, 0));
  const denominator = rate.denominator * 10n ** BigInt(Math.max(-shift, 0));
  return divideMinorBig(BigInt(money.amount()) * numerator, denominator, 'conversion');
}
