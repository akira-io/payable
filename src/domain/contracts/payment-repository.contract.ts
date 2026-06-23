import type { Payment } from '../entities/payment.entity';
import type { ListOptions } from './list-options.contract';

export type NewPayment = Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>;

export interface PaymentRepository {
  create(data: NewPayment): Promise<Payment>;
  update(id: string, patch: Partial<NewPayment>): Promise<Payment>;
  findById(id: string): Promise<Payment | null>;
  findByProviderId(provider: string, providerPaymentId: string): Promise<Payment | null>;
  listByCustomer(customerId: string, options?: ListOptions): Promise<Payment[]>;
}
