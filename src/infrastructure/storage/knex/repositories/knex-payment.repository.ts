import type { PaymentRepository } from '../../../../domain/contracts/payment-repository.contract';
import type { Payment } from '../../../../domain/entities/payment.entity';
import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 3
export class KnexPaymentRepository implements PaymentRepository {
  constructor(protected readonly connection: unknown) {}

  create(): Promise<Payment> {
    return this.unsupported('create');
  }

  update(): Promise<Payment> {
    return this.unsupported('update');
  }

  findById(): Promise<Payment | null> {
    return this.unsupported('findById');
  }

  findByProviderId(): Promise<Payment | null> {
    return this.unsupported('findByProviderId');
  }

  listByCustomer(): Promise<Payment[]> {
    return this.unsupported('listByCustomer');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`KnexPaymentRepository.${op} (Phase 3)`);
  }
}
