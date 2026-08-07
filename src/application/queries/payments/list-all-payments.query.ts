import type { ListOptions } from '../../../domain/contracts/list-options.contract';
import type { Payment } from '../../../domain/entities/payment.entity';
import type { LocalDependencies } from '../../builders/local-dependencies';

export class ListAllPaymentsQuery {
  constructor(private readonly deps: LocalDependencies) {}

  run(options?: ListOptions): Promise<Payment[]> {
    const storage = this.deps.storage;
    if (!storage) {
      return Promise.resolve([]);
    }
    return storage.payments.list(this.deps.tenantId ?? null, options);
  }
}
