import type { ChargeResultDTO } from '../../domain/dtos/charge.dto';
import { PayableError } from '../../domain/errors/payable-error';
import type { Billable } from './billable';
import type { ChargeRequest } from './charge-builder';
import { SubscriptionBuilder } from './subscription-builder';
import { SubscriptionManager } from './subscription-manager';

export class CustomerContext {
  constructor(private readonly billable: Billable) {}

  newSubscription(name: string): SubscriptionBuilder {
    return new SubscriptionBuilder(name);
  }

  subscription(name: string): SubscriptionManager {
    return new SubscriptionManager(this.billable, name);
  }

  // TODO: Phase 10 - execute a one-time charge for this customer.
  async charge(request: ChargeRequest): Promise<ChargeResultDTO> {
    throw PayableError.notImplemented(
      `CustomerContext.charge (${this.billable.billableId} / ${request.reference ?? 'no-reference'})`,
    );
  }
}
