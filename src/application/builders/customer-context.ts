import type { ChargeResultDTO } from '../../domain/dtos/charge.dto';
import { PayableError } from '../../domain/errors/payable-error';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';
import type { ChargeRequest } from './charge-builder';
import { CheckoutBuilder } from './checkout-builder';
import { SubscriptionBuilder } from './subscription-builder';
import { SubscriptionManager } from './subscription-manager';

export class CustomerContext {
  constructor(
    private readonly billable: Billable,
    private readonly deps: BillingDependencies,
  ) {}

  newSubscription(name: string): SubscriptionBuilder {
    return new SubscriptionBuilder(name, this.billable, this.deps);
  }

  checkout(): CheckoutBuilder {
    return new CheckoutBuilder(this.billable, this.deps);
  }

  subscription(name: string): SubscriptionManager {
    return new SubscriptionManager(this.billable, name);
  }

  async charge(request: ChargeRequest): Promise<ChargeResultDTO> {
    throw PayableError.notImplemented(
      `CustomerContext.charge (${this.billable.billableId} / ${request.reference ?? 'no-reference'})`,
    );
  }
}
