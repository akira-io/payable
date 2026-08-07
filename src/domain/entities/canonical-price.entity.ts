import type { CurrencyCode } from '../value-objects/currency';
import type { RecurringInterval, TenantScoped, Timestamps } from './common';

export type CanonicalPriceType = 'one_time' | 'recurring';

export interface CanonicalPrice extends TenantScoped, Timestamps {
  readonly id: string;
  readonly productId: string;
  readonly currency: CurrencyCode;
  readonly unitAmount: number;
  readonly type: CanonicalPriceType;
  readonly interval: RecurringInterval | null;
  readonly intervalCount: number | null;
  readonly description: string | null;
  readonly lookupKey: string | null;
  readonly active: boolean;
}
