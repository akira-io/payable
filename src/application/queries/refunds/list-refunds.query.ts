import type { Refund } from '../../../domain/entities/refund.entity';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class ListRefundsQuery {
  constructor(private readonly deps: BillingDependencies) {}

  async run(paymentId: string): Promise<Refund[]> {
    const storage = this.deps.storage;
    if (!storage) {
      return [];
    }
    return storage.refunds.listByPayment(paymentId);
  }
}
