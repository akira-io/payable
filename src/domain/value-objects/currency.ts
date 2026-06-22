import * as currencies from 'dinero.js/currencies';

export type CurrencyCode = string;

export interface DineroCurrency {
  readonly code: string;
  readonly base: number | number[];
  readonly exponent: number;
}

const registry = currencies as unknown as Record<string, DineroCurrency>;

function isCurrency(value: unknown): value is DineroCurrency {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'exponent' in value &&
    typeof (value as DineroCurrency).exponent === 'number'
  );
}

export const CurrencyManager = {
  supports(code: CurrencyCode): boolean {
    return isCurrency(registry[code.toUpperCase()]);
  },

  resolve(code: CurrencyCode): DineroCurrency {
    const currency = registry[code.toUpperCase()];
    if (!isCurrency(currency)) {
      throw new RangeError(`Unsupported currency code: ${code}`);
    }
    return currency;
  },

  precision(code: CurrencyCode): number {
    return CurrencyManager.resolve(code).exponent;
  },

  normalize(code: CurrencyCode): CurrencyCode {
    return CurrencyManager.resolve(code).code;
  },
} as const;
