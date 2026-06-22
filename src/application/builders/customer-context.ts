import type { BillingPortalDTO } from '../../domain/dtos/billing-portal.dto';
import type { Payment } from '../../domain/entities/payment.entity';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import { SyncCustomerWithProviderAction } from '../actions/customers/sync-customer-with-provider.action';
import { ChargeAction } from '../actions/payments/charge.action';
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
    return new SubscriptionManager(this.billable, name, this.deps);
  }

  charge(request: ChargeRequest): Promise<Payment> {
    return new ChargeAction(this.deps).handle({
      billable: this.billable,
      amount: request.amount,
      reference: request.reference,
      description: request.description,
    });
  }

  async billingPortal(returnUrl: string): Promise<BillingPortalDTO> {
    const providerCustomerId = await new SyncCustomerWithProviderAction(this.deps).handle(
      this.billable,
    );
    const key = `portal:${this.deps.providerName}:${this.billable.billableType}:${this.billable.billableId}`;
    return this.deps.provider.billingPortal(
      { providerCustomerId, returnUrl },
      { correlationId: CorrelationId.generate().toString(), idempotencyKey: key },
    );
  }
}
