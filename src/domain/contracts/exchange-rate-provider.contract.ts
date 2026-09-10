import type { CurrencyCode } from '../value-objects/currency';
import type { ExchangeRate } from '../value-objects/exchange-rate';

export interface ExchangeRateProvider {
  rateFor(from: CurrencyCode, to: CurrencyCode): Promise<ExchangeRate | undefined>;
}
