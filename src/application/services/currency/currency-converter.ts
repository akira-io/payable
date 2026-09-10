import type { ExchangeRateProvider } from '../../../domain/contracts/exchange-rate-provider.contract';
import { ExchangeRateNotFoundError } from '../../../domain/errors/exchange-rate-not-found.error';
import { ExchangeRatePairMismatchError } from '../../../domain/errors/exchange-rate-pair-mismatch.error';
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
    if (rate.from !== source || rate.to !== target) {
      throw new ExchangeRatePairMismatchError(source, target, rate.from, rate.to);
    }
    return new CurrencyConversion(money, Money.of(applyRate(money, rate, target), target), rate);
  }
}

function applyRate(money: Money, rate: ExchangeRate, target: CurrencyCode): number {
  const numerator = rate.numerator * BigInt(CurrencyManager.minorUnitsPerMajor(target));
  const denominator =
    rate.denominator * BigInt(CurrencyManager.minorUnitsPerMajor(money.currency()));
  return divideMinorBig(BigInt(money.amount()) * numerator, denominator, 'conversion');
}
