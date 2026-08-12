import type { CurrencyCode } from '../value-objects/currency';
import type { RefundStatus } from '../value-objects/refund-status';
import type { TenantScoped, Timestamps } from './common';
import type { CollectionMethod } from './payment.entity';

export interface Refund extends TenantScoped, Timestamps {
  readonly id: string;
  readonly paymentId: string;
  readonly provider: string | null;
  readonly providerRefundId: string | null;
  readonly status: RefundStatus;
  readonly currency: CurrencyCode;
  readonly amount: number;
  readonly reason: string | null;
  readonly collectionMethod: CollectionMethod | null;
  readonly occurredAt: Date | null;
  readonly externalReference: string | null;
  readonly recordedBy: string | null;
}
