import type { CurrencyCode } from './currency';
import type { ExchangeRate } from './exchange-rate';
import type { Money } from './money';

export class CurrencyConversion {
  constructor(
    readonly source: Money,
    readonly converted: Money,
    readonly rate: ExchangeRate,
  ) {}

  toJSON(): {
    source: { amount: number; currency: CurrencyCode };
    converted: { amount: number; currency: CurrencyCode };
    rate: { from: CurrencyCode; to: CurrencyCode; rate: string };
  } {
    return {
      source: this.source.toJSON(),
      converted: this.converted.toJSON(),
      rate: this.rate.toJSON(),
    };
  }
}
