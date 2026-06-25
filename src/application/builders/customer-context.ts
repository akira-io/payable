import type { ListOptions } from '../../domain/contracts/list-options.contract';
import type { BillingPortalDTO } from '../../domain/dtos/billing-portal.dto';
import type { InvoiceDTO } from '../../domain/dtos/invoice.dto';
import type { Payment } from '../../domain/entities/payment.entity';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key';
import { SyncCustomerWithProviderAction } from '../actions/customers/sync-customer-with-provider.action';
import { ListInvoicesAction } from '../actions/invoices/list-invoices.action';
import { ChargeAction } from '../actions/payments/charge.action';
import { ListPaymentsQuery } from '../queries/payments/list-payments.query';
import { assertProviderCapability } from '../services/provider-capabilities/assert-provider-capability';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';
import type { ChargeRequest } from './charge-request';
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

  invoices(limit?: number): Promise<InvoiceDTO[]> {
    return new ListInvoicesAction(this.deps).handle(this.billable, limit);
  }

  payments(options?: ListOptions): Promise<Payment[]> {
    return new ListPaymentsQuery(this.deps).run(this.billable, options);
  }

  async billingPortal(returnUrl: string): Promise<BillingPortalDTO> {
    assertProviderCapability(this.deps.provider, 'billingPortal');
    const providerCustomerId = await new SyncCustomerWithProviderAction(this.deps).handle(
      this.billable,
    );
    const key = IdempotencyKey.forBillingPortal({
      tenantId: this.deps.tenantId ?? null,
      provider: this.deps.providerName,
      billableType: this.billable.billableType,
      billableId: this.billable.billableId,
    });
    return this.deps.provider.billingPortal(
      { providerCustomerId, returnUrl },
      { correlationId: CorrelationId.generate().toString(), idempotencyKey: key.toString() },
    );
  }
}
