import type { Refund } from '../entities/refund.entity';
import type { ListOptions } from './list-options.contract';

export type NewRefund = Omit<Refund, 'id' | 'createdAt' | 'updatedAt'>;

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
