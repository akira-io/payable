import { type CurrencyCode, type CurrencyInput, CurrencyManager } from './currency';

export type ExchangeRateInput = number | string;

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

export class ExchangeRate {
  private constructor(
    readonly from: CurrencyCode,
    readonly to: CurrencyCode,
    readonly rate: string,
    readonly numerator: bigint,
    readonly denominator: bigint,
  ) {}

  static of(from: CurrencyInput, to: CurrencyInput, rate: ExchangeRateInput): ExchangeRate {
    const text = decimalText(rate);
    const [units = '', fraction = ''] = text.split('.');
    const numerator = BigInt(`${units}${fraction}`);
    if (numerator === 0n) {
      throw new RangeError(`Exchange rate must be greater than zero, got ${text}`);
    }
    return new ExchangeRate(
      CurrencyManager.normalize(from),
      CurrencyManager.normalize(to),
      text,
      numerator,
      10n ** BigInt(fraction.length),
    );
  }

  static identity(currency: CurrencyInput): ExchangeRate {
    const code = CurrencyManager.normalize(currency);
    return new ExchangeRate(code, code, '1', 1n, 1n);
  }

  toJSON(): { from: CurrencyCode; to: CurrencyCode; rate: string } {
    return { from: this.from, to: this.to, rate: this.rate };
  }
}

function decimalText(rate: ExchangeRateInput): string {
  if (typeof rate === 'number' && !Number.isFinite(rate)) {
    throw new TypeError(`Exchange rate must be finite, got ${rate}`);
  }
  const text = typeof rate === 'number' ? String(rate) : rate.trim();
  if (!DECIMAL_PATTERN.test(text)) {
    throw new TypeError(`Exchange rate must be a positive decimal, got ${String(rate)}`);
  }
  return text;
}
