import { CurrencyManager } from '../../domain/value-objects/currency';

export function catalogCurrencyCaseVariants(currency: string): string[] {
  const normalized = CurrencyManager.normalize(currency);
  const first = normalized.charAt(0);
  const second = normalized.charAt(1);
  const third = normalized.charAt(2);
  return [
    `${first}${second}${third}`,
    `${first}${second}${third.toLowerCase()}`,
    `${first}${second.toLowerCase()}${third}`,
    `${first}${second.toLowerCase()}${third.toLowerCase()}`,
    `${first.toLowerCase()}${second}${third}`,
    `${first.toLowerCase()}${second}${third.toLowerCase()}`,
    `${first.toLowerCase()}${second.toLowerCase()}${third}`,
    `${first.toLowerCase()}${second.toLowerCase()}${third.toLowerCase()}`,
  ];
}
