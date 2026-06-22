import type { CurrencyCode } from '../value-objects/currency';

export interface Timestamps {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TenantScoped {
  readonly tenantId: string | null;
}

export interface StoredMoney {
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export type RecurringInterval = 'day' | 'week' | 'month' | 'year';

export type Metadata = Record<string, string>;
