import type { Payment } from '../entities/payment.entity';

export type NewPayment = Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>;

export interface PaymentRepository {
  create(data: NewPayment): Promise<Payment>;
  update(id: string, patch: Partial<NewPayment>): Promise<Payment>;
  findById(id: string): Promise<Payment | null>;
  findByProviderId(provider: string, providerPaymentId: string): Promise<Payment | null>;
  listByCustomer(customerId: string, limit?: number): Promise<Payment[]>;
}
