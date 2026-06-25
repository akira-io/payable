import type { ListOptions } from '../../domain/contracts/list-options.contract';
import type { Refund } from '../../domain/entities/refund.entity';
import { ListRefundsQuery } from '../queries/refunds/list-refunds.query';
import type { BillingDependencies } from './billing-dependencies';

export class RefundResource {
  constructor(private readonly deps: BillingDependencies) {}

  list(paymentId: string, options?: ListOptions): Promise<Refund[]> {
    return new ListRefundsQuery(this.deps).run(paymentId, options);
  }
}
