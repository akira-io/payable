import type { CurrencyCode } from '../value-objects/currency';
import type { RecurringInterval, TenantScoped, Timestamps } from './common';

export interface Price extends TenantScoped, Timestamps {
  readonly id: string;
  readonly provider: string;
  readonly providerPriceId: string | null;
  readonly productId: string;
  readonly currency: CurrencyCode;
  readonly unitAmount: number;
  readonly interval: RecurringInterval | null;
  readonly intervalCount: number | null;
  readonly active: boolean;
}
