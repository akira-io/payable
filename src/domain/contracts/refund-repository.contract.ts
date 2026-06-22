import type { Refund } from '../entities/refund.entity';

export type NewRefund = Omit<Refund, 'id' | 'createdAt' | 'updatedAt'>;

export interface RefundRepository {
  create(data: NewRefund): Promise<Refund>;
  update(id: string, patch: Partial<NewRefund>): Promise<Refund>;
  findById(id: string): Promise<Refund | null>;
  findByProviderId(provider: string, providerRefundId: string): Promise<Refund | null>;
  listByPayment(paymentId: string): Promise<Refund[]>;
}
