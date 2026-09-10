import type { ExchangeRateProvider } from '../../domain/contracts/exchange-rate-provider.contract';
import { type CurrencyCode, CurrencyManager } from '../../domain/value-objects/currency';
import { ExchangeRate, type ExchangeRateInput } from '../../domain/value-objects/exchange-rate';

export type FixedExchangeRateTable = Readonly<Record<string, ExchangeRateInput>>;

export class FixedExchangeRateProvider implements ExchangeRateProvider {
  private readonly rates: Map<string, ExchangeRate>;

  constructor(table: FixedExchangeRateTable) {
    this.rates = new Map();
    for (const [pair, rate] of Object.entries(table)) {
      const [from, to] = splitPair(pair);
      const key = pairKey(from, to);
      if (this.rates.has(key)) {
        throw new TypeError(`Duplicate exchange rate pair after normalization: ${key}`);
      }
      this.rates.set(key, ExchangeRate.of(from, to, rate));
    }
  }

  async rateFor(from: CurrencyCode, to: CurrencyCode): Promise<ExchangeRate | undefined> {
    return this.rates.get(pairKey(from, to));
  }
}

function splitPair(pair: string): [string, string] {
  const parts = pair.split('/');
  const [from, to] = parts;
  if (parts.length !== 2 || !from || !to) {
    throw new TypeError(`Exchange rate pair must be formatted as FROM/TO, got ${pair}`);
  }
  return [from, to];
}

function pairKey(from: CurrencyCode, to: CurrencyCode): string {
  return `${CurrencyManager.normalize(from)}/${CurrencyManager.normalize(to)}`;
}
