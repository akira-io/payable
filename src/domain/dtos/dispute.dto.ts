import type { Money } from '../value-objects/money';

export type DisputeStatus =
  | 'needs_response'
  | 'under_review'
  | 'won'
  | 'lost'
  | 'prevented'
  | 'warning_needs_response'
  | 'warning_under_review'
  | 'warning_closed';

export interface ListDisputesInput {
  limit?: number;
}

export interface DisputeDTO {
  providerDisputeId: string;
  providerPaymentId: string | null;
  status: DisputeStatus;
  reason: string | null;
  amount: Money;
  responseDueAt: Date | null;
  createdAt: Date | null;
}
