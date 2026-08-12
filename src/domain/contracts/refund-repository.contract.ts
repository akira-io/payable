import type { Refund } from '../entities/refund.entity';
import type { ListOptions } from './list-options.contract';

type RefundEvidence = Pick<
  Refund,
  'collectionMethod' | 'occurredAt' | 'externalReference' | 'recordedBy'
>;
export type NewRefund = Omit<Refund, 'id' | 'createdAt' | 'updatedAt' | keyof RefundEvidence> &
  Partial<RefundEvidence>;

export interface RefundRepository {
  create(data: NewRefund): Promise<Refund>;
  update(id: string, patch: Partial<NewRefund>): Promise<Refund>;
  findById(id: string, tenantId?: string | null): Promise<Refund | null>;
  findByProviderId(
    provider: string,
    providerRefundId: string,
    tenantId?: string | null,
  ): Promise<Refund | null>;
  listByPayment(
    paymentId: string,
    tenantId?: string | null,
    options?: ListOptions,
  ): Promise<Refund[]>;
}
