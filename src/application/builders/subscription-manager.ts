import type {
  ApplySubscriptionChangeInput,
  PreviewSubscriptionChangeInput,
  SubscriptionChangePolicies,
  SubscriptionChangePreview,
} from '../../domain/dtos/subscription-change.dto';
import type { Subscription } from '../../domain/entities/subscription.entity';
import { ApplySubscriptionChangeAction } from '../actions/subscriptions/apply-subscription-change.action';
import { CancelSubscriptionAction } from '../actions/subscriptions/cancel-subscription.action';
import { CancelSubscriptionNowAction } from '../actions/subscriptions/cancel-subscription-now.action';
import { PreviewSubscriptionChangeAction } from '../actions/subscriptions/preview-subscription-change.action';
import { ResumeSubscriptionAction } from '../actions/subscriptions/resume-subscription.action';
import { SwapSubscriptionAction } from '../actions/subscriptions/swap-subscription.action';
import { UpdateSubscriptionQuantityAction } from '../actions/subscriptions/update-subscription-quantity.action';
import type { AuthorizationContext } from '../policies/authorization-context';
import { FindSubscriptionQuery } from '../queries/subscriptions/find-subscription.query';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';

export interface SwapOptions extends SubscriptionChangePolicies {
  priceId: string;
  itemId?: string;
  authorization?: AuthorizationContext;
}

export interface UpdateQuantityOptions extends SubscriptionChangePolicies {
  quantity: number;
  itemId?: string;
  authorization?: AuthorizationContext;
}

export class SubscriptionManager {
  constructor(
    private readonly billable: Billable,
    private readonly name: string,
    private readonly deps: BillingDependencies,
  ) {}

  get(): Promise<Subscription | null> {
    return new FindSubscriptionQuery(this.deps).run(this.billable, this.name);
  }

  previewChange(
    input: PreviewSubscriptionChangeInput,
    authorization?: AuthorizationContext,
  ): Promise<SubscriptionChangePreview> {
    return new PreviewSubscriptionChangeAction(this.deps).handle(
      this.billable,
      this.name,
      input,
      authorization,
    );
  }

  applyChange(
    input: ApplySubscriptionChangeInput,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    return new ApplySubscriptionChangeAction(this.deps).handle(
      this.billable,
      this.name,
      input,
      authorization,
    );
  }

  swap(options: SwapOptions): Promise<Subscription>;
  swap(
    priceIdOrOptions: string | SwapOptions,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    if (typeof priceIdOrOptions === 'string') {
      return new SwapSubscriptionAction(this.deps).handle(
        this.billable,
        this.name,
        priceIdOrOptions,
        authorization,
      );
    }
    return new SwapSubscriptionAction(this.deps).handle(
      this.billable,
      this.name,
      priceIdOrOptions.priceId,
      priceIdOrOptions.authorization,
      priceIdOrOptions.itemId,
      priceIdOrOptions,
    );
  }

  cancel(authorization?: AuthorizationContext): Promise<Subscription> {
    return new CancelSubscriptionAction(this.deps).handle(this.billable, this.name, authorization);
  }

  cancelNow(authorization?: AuthorizationContext): Promise<Subscription> {
    return new CancelSubscriptionNowAction(this.deps).handle(
      this.billable,
      this.name,
      authorization,
    );
  }

  resume(authorization?: AuthorizationContext): Promise<Subscription> {
    return new ResumeSubscriptionAction(this.deps).handle(this.billable, this.name, authorization);
  }

  updateQuantity(options: UpdateQuantityOptions): Promise<Subscription>;
  updateQuantity(
    quantityOrOptions: number | UpdateQuantityOptions,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    if (typeof quantityOrOptions === 'number') {
      return new UpdateSubscriptionQuantityAction(this.deps).handle(
        this.billable,
        this.name,
        quantityOrOptions,
        authorization,
      );
    }
    return new UpdateSubscriptionQuantityAction(this.deps).handle(
      this.billable,
      this.name,
      quantityOrOptions.quantity,
      quantityOrOptions.authorization,
      quantityOrOptions.itemId,
      quantityOrOptions,
    );
  }
}
