import type { RecurringInterval } from '../entities/common';
import type { Money } from '../value-objects/money';

export interface CreatePriceInput {
  providerProductId: string;
  unitAmount: Money;
  interval?: RecurringInterval;
  intervalCount?: number;
  description?: string;
}

export interface PriceDTO {
  providerPriceId: string;
  providerProductId: string;
  unitAmount: Money;
  interval: RecurringInterval | null;
}
