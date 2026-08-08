import type { RecurringInterval } from '../entities/common';
import type { Money } from '../value-objects/money';

export interface CreatePriceInput {
  providerProductId: string;
  unitAmount: Money;
  interval?: RecurringInterval;
  intervalCount?: number;
  description?: string;
  lookupKey?: string;
  transferLookupKey?: boolean;
}

export interface TransferPriceLookupKeyInput {
  providerPriceId: string;
  lookupKey: string;
}

export interface UpdatePriceInput {
  providerPriceId: string;
  description?: string | null;
}

export interface PriceDTO {
  providerPriceId: string;
  providerProductId: string;
  unitAmount: Money;
  interval: RecurringInterval | null;
  intervalCount: number | null;
  description: string | null;
  active: boolean;
  lookupKey: string | null;
  providerVersion?: string | null;
}
