import type { CheckoutMode, CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import { CreateCheckoutSessionAction } from '../../actions/checkout/create-checkout-session.action';
import { SyncCustomerWithProviderAction } from '../../actions/customers/sync-customer-with-provider.action';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export interface CreateCheckoutInput {
  billable: Billable;
  mode: CheckoutMode;
  lineItems: { priceId: string; quantity: number }[];
  successUrl: string;
  cancelUrl: string;
  subscriptionName: string;
  trialDays?: number;
  coupon?: string;
}

export class CreateCheckoutPipeline {
  private readonly syncCustomer: SyncCustomerWithProviderAction;
  private readonly createSession: CreateCheckoutSessionAction;

  constructor(private readonly deps: BillingDependencies) {
    this.syncCustomer = new SyncCustomerWithProviderAction(deps);
    this.createSession = new CreateCheckoutSessionAction(deps);
  }

  async handle(input: CreateCheckoutInput): Promise<CheckoutSessionDTO> {
    const providerCustomerId = await this.syncCustomer.handle(input.billable);
    const key = IdempotencyKey.forCheckout({
      provider: this.deps.providerName,
      billableType: input.billable.billableType,
      billableId: input.billable.billableId,
      price: input.lineItems.map((item) => `${item.priceId}:${item.quantity}`).join(','),
      subscriptionName: input.subscriptionName,
    });
    return this.createSession.handle({
      input: {
        providerCustomerId,
        mode: input.mode,
        lineItems: input.lineItems,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        trialDays: input.trialDays,
        coupon: input.coupon,
      },
      idempotencyKey: key.toString(),
    });
  }
}
