import type { Payment } from '../entities/payment.entity';
import type { CurrencyCode } from '../value-objects/currency';
import type { PaymentStatus } from '../value-objects/payment-status';
import type { ListCursor, ListOptions } from './list-options.contract';

type PaymentEvidence = Pick<
  Payment,
  | 'collectionMethod'
  | 'occurredAt'
  | 'externalReference'
  | 'recordedBy'
  | 'capturedAmount'
  | 'authorizedAt'
  | 'authorizationExpiresAt'
>;
export type NewPayment = Omit<Payment, 'id' | 'createdAt' | 'updatedAt' | keyof PaymentEvidence> &
  Partial<PaymentEvidence>;

export interface RefundedAmountPatch {
  refundedAmount: number;
  status: PaymentStatus;
}

export interface PaymentListQuery {
  limit: number;
  before?: ListCursor;
  id?: string;
  customerId?: string;
  status?: PaymentStatus;
  currency?: CurrencyCode;
  reference?: string;
  description?: string;
}

export interface PaymentListResult {
  items: Payment[];
  hasMore: boolean;
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
  updateStatusIfUnchanged(
    id: string,
    expectedStatus: PaymentStatus,
    patch: Partial<NewPayment>,
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
  page?(query: PaymentListQuery, tenantId: string | null): Promise<PaymentListResult>;
}
