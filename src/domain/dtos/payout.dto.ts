import type { Money } from '../value-objects/money';

export type PayoutStatus = 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled';

export interface ListPayoutsInput {
  limit?: number;
}

export interface PayoutDTO {
  providerPayoutId: string;
  status: PayoutStatus;
  amount: Money | null;
  createdAt: Date | null;
  arrivalAt: Date | null;
}
