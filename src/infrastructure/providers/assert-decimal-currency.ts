import { PayableError } from '../../domain/errors/payable-error';
import { CurrencyManager } from '../../domain/value-objects/currency';

export function assertDecimalCurrency(provider: string, currency: string): void {
  const code = currency.toUpperCase();
  if (!CurrencyManager.isDecimalBase(code)) {
    throw new PayableError(
      `${provider} cannot process currency ${code}: only base-10 currencies are supported`,
      {
        code: 'PROVIDER_CURRENCY_BASE_UNSUPPORTED',
        context: { provider, currency: code },
      },
    );
  }
}
