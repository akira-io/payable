import type { Subscription } from '../../../domain/entities/subscription.entity';
import { CustomerNotFoundError } from '../../../domain/errors/customer-not-found.error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Billable } from '../../builders/billable';
import { SyncCustomerWithProviderAction } from '../customers/sync-customer-with-provider.action';
import { SubscriptionAction } from './subscription-action';

export interface CreateSubscriptionInputData {
  billable: Billable;
  name: string;
  priceId: string;
  quantity?: number;
  trialDays?: number;
  coupon?: string;
}

export class CreateSubscriptionAction extends SubscriptionAction {
  async handle(input: CreateSubscriptionInputData): Promise<Subscription> {
    const storage = this.storage();
    const providerCustomerId = await new SyncCustomerWithProviderAction(this.deps).handle(
      input.billable,
    );
    const customer = await storage.customers.findByBillable(
      input.billable.billableType,
      input.billable.billableId,
    );
    if (!customer) {
      throw new CustomerNotFoundError(input.billable.billableId);
    }
    const key = IdempotencyKey.forSubscription({
      provider: this.deps.providerName,
      billableType: input.billable.billableType,
      billableId: input.billable.billableId,
      subscriptionName: input.name,
      price: input.priceId,
    });
    const dto = await this.deps.provider.createSubscription(
      {
        providerCustomerId,
        priceId: input.priceId,
        quantity: input.quantity,
        trialDays: input.trialDays,
        coupon: input.coupon,
      },
      { correlationId: CorrelationId.generate().toString(), idempotencyKey: key.toString() },
    );
    return storage.subscriptions.create({
      tenantId: null,
      customerId: customer.id,
      name: input.name,
      provider: this.deps.providerName,
      providerSubscriptionId: dto.providerSubscriptionId,
      status: dto.status,
      priceId: input.priceId,
      quantity: input.quantity ?? 1,
      trialEndsAt: dto.trialEndsAt,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: dto.currentPeriodEnd,
    });
  }
}
