import type { CustomerRepository } from '../../../../domain/contracts/customer-repository.contract';
import type { Customer } from '../../../../domain/entities/customer.entity';
import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 3
export class KnexCustomerRepository implements CustomerRepository {
  constructor(protected readonly connection: unknown) {}

  create(): Promise<Customer> {
    return this.unsupported('create');
  }

  update(): Promise<Customer> {
    return this.unsupported('update');
  }

  findById(): Promise<Customer | null> {
    return this.unsupported('findById');
  }

  findByBillable(): Promise<Customer | null> {
    return this.unsupported('findByBillable');
  }

  findByProviderId(): Promise<Customer | null> {
    return this.unsupported('findByProviderId');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`KnexCustomerRepository.${op} (Phase 3)`);
  }
}
