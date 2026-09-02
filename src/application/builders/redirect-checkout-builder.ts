import type { CheckoutSessionDTO } from '../../domain/dtos/checkout.dto';
import type { Customer } from '../../domain/entities/customer.entity';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key';
import type { Money } from '../../domain/value-objects/money';
import { CreateCheckoutSessionAction } from '../actions/checkout/create-checkout-session.action';
import { SyncCustomerWithProviderAction } from '../actions/customers/sync-customer-with-provider.action';
import { assertAuthorized } from '../policies/assert-authorized';
import type { AuthorizationContext } from '../policies/authorization-context';
import { CanCreateCheckoutPolicy } from '../policies/can-create-checkout.policy';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';
import { CustomerResource } from './customer-resource';

export interface RedirectCheckoutRequest {
  successUrl?: string;
  cancelUrl?: string;
  reference?: string;
  providerData?: Record<string, unknown>;
  authorization?: AuthorizationContext;
}

export class RedirectCheckoutBuilder {
  constructor(
    private readonly billable: Billable,
    private readonly amount: Money,
    private readonly deps: BillingDependencies,
  ) {}

  async create(request: RedirectCheckoutRequest = {}): Promise<CheckoutSessionDTO> {
    assertAuthorized(
      this.deps.authorizationEnabled ?? false,
      (context) => new CanCreateCheckoutPolicy().authorize(context),
      request.authorization,
      'create checkout',
    );
    const customers = new CustomerResource(this.deps);
    const customer = this.deps.storage ? await customers.create(this.billable) : null;
    const providerCustomerId =
      customer && this.deps.provider.capabilities().has('customers')
        ? await new SyncCustomerWithProviderAction(this.deps).handle(this.billable)
        : '';
    const key = IdempotencyKey.forCheckout({
      tenantId: this.deps.tenantId ?? null,
      provider: this.deps.providerName,
      billableType: this.billable.billableType,
      billableId: this.billable.billableId,
      price: `amount:${this.amount.amount()}:${this.amount.currency()}`,
      subscriptionName: 'default',
      reference: request.reference,
    });
    const session = await new CreateCheckoutSessionAction(this.deps).handle({
      input: {
        providerCustomerId,
        mode: 'payment',
        lineItems: [],
        successUrl: request.successUrl ?? '',
        cancelUrl: request.cancelUrl ?? '',
        reference: request.reference,
        amount: this.amount,
        providerData: request.providerData,
      },
      idempotencyKey: key.toString(),
    });
    if (customer) {
      await this.recordPendingPayment(customer, session.id, request.reference ?? null);
    }
    return session;
  }

  private async recordPendingPayment(
    customer: Customer,
    providerPaymentId: string,
    reference: string | null,
  ): Promise<void> {
    const storage = this.deps.storage;
    if (!storage) {
      return;
    }
    const existing = await storage.payments.findByProviderId(
      this.deps.providerName,
      providerPaymentId,
      this.deps.tenantId ?? null,
    );
    if (existing) {
      return;
    }
    await storage.payments.create({
      tenantId: this.deps.tenantId ?? null,
      customerId: customer.id,
      provider: this.deps.providerName,
      providerPaymentId,
      status: 'pending',
      currency: this.amount.currency(),
      amount: this.amount.amount(),
      refundedAmount: 0,
      reference,
      description: null,
    });
  }
}
