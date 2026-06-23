import { isDirectSubscriptionCapable } from '../../../domain/contracts/payment-provider.contract';
import type { SubscriptionLineItem } from '../../../domain/dtos/subscription.dto';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import { CustomerNotFoundError } from '../../../domain/errors/customer-not-found.error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
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
  items?: SubscriptionLineItem[];
  trialDays?: number;
  coupon?: string;
}

export class CreateSubscriptionAction extends SubscriptionAction {
  async handle(input: CreateSubscriptionInputData): Promise<Subscription> {
    const provider = this.deps.provider;
    if (!isDirectSubscriptionCapable(provider)) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'direct subscription creation');
    }
    const storage = this.storage();
    const providerCustomerId = await new SyncCustomerWithProviderAction(this.deps).handle(
      input.billable,
    );
    const customer = await storage.customers.findByBillable(
      input.billable.billableType,
      input.billable.billableId,
      this.deps.tenantId ?? null,
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
    const items = input.items ?? [{ priceId: input.priceId, quantity: input.quantity ?? 1 }];
    const run = async (): Promise<Subscription> => {
      const dto = await provider.createSubscription(
        {
          providerCustomerId,
          priceId: input.priceId,
          quantity: input.quantity,
          items: input.items,
          trialDays: input.trialDays,
          coupon: input.coupon,
        },
        { correlationId: CorrelationId.generate().toString(), idempotencyKey: key.toString() },
      );
      return storage.transaction(async (repos) => {
        const subscription = await repos.subscriptions.create({
          tenantId: this.deps.tenantId ?? null,
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
        await repos.subscriptionItems.createMany(
          items.map((item) => ({
            subscriptionId: subscription.id,
            priceId: item.priceId,
            providerItemId: null,
            quantity: item.quantity,
          })),
        );
        return subscription;
      });
    };
    if (!this.deps.idempotency) {
      return run();
    }
    return this.deps.idempotency.execute({
      key: key.toString(),
      scope: 'subscription',
      operation: 'create-subscription',
      request: {
        billableType: input.billable.billableType,
        billableId: input.billable.billableId,
        subscriptionName: input.name,
        price: input.priceId,
      },
      resourceType: 'subscription',
      tenantId: this.deps.tenantId,
      run,
    });
  }
}
