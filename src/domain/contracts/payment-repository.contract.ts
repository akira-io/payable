import type { Payment } from '../entities/payment.entity';
import type { PaymentStatus } from '../value-objects/payment-status';
import type { ListOptions } from './list-options.contract';

export type NewPayment = Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>;

export interface RefundedAmountPatch {
  refundedAmount: number;
  status: PaymentStatus;
}

export interface PaymentRepository {
  create(data: NewPayment): Promise<Payment>;
  update(id: string, patch: Partial<NewPayment>, tenantId?: string | null): Promise<Payment>;
  updateRefundedAmountIfUnchanged(
    id: string,
    expectedRefundedAmount: number,
    patch: RefundedAmountPatch,
    tenantId?: string | null,
  ): Promise<boolean>;
  findById(id: string, tenantId?: string | null): Promise<Payment | null>;
  findByIdForUpdate(id: string, tenantId?: string | null): Promise<Payment | null>;
  findByProviderId(
    provider: string,
    providerPaymentId: string,
    tenantId?: string | null,
  ): Promise<Payment | null>;
  listByCustomer(
    customerId: string,
    tenantId?: string | null,
    options?: ListOptions,
  ): Promise<Payment[]>;
  list(tenantId?: string | null, options?: ListOptions): Promise<Payment[]>;
}
