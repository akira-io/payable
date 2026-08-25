import type {
  ApplySubscriptionChangeInput,
  PreviewSubscriptionChangeInput,
  SubscriptionChangePolicies,
  SubscriptionChangePreview,
} from '../../domain/dtos/subscription-change.dto';
import type {
  PausePaymentCollectionPolicy,
  PauseSubscriptionPolicy,
  ResumePausedSubscriptionPolicy,
} from '../../domain/dtos/subscription-pause-policy.dto';
import type { Subscription } from '../../domain/entities/subscription.entity';
import { ApplySubscriptionChangeAction } from '../actions/subscriptions/apply-subscription-change.action';
import { CancelScheduledSubscriptionChangeAction } from '../actions/subscriptions/cancel-scheduled-subscription-change.action';
import { CancelSubscriptionAction } from '../actions/subscriptions/cancel-subscription.action';
import { CancelSubscriptionNowAction } from '../actions/subscriptions/cancel-subscription-now.action';
import { PausePaymentCollectionAction } from '../actions/subscriptions/pause-payment-collection.action';
import { PauseSubscriptionAction } from '../actions/subscriptions/pause-subscription.action';
import { PreviewSubscriptionChangeAction } from '../actions/subscriptions/preview-subscription-change.action';
import { ResumePausedSubscriptionAction } from '../actions/subscriptions/resume-paused-subscription.action';
import { ResumePaymentCollectionAction } from '../actions/subscriptions/resume-payment-collection.action';
import { ResumeSubscriptionAction } from '../actions/subscriptions/resume-subscription.action';
import { SwapSubscriptionAction } from '../actions/subscriptions/swap-subscription.action';
import { UpdateSubscriptionQuantityAction } from '../actions/subscriptions/update-subscription-quantity.action';
import type { AuthorizationContext } from '../policies/authorization-context';
import { FindSubscriptionQuery } from '../queries/subscriptions/find-subscription.query';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';

export type SwapOptions = SubscriptionChangePolicies & {
  priceId: string;
  itemId?: string;
  authorization?: AuthorizationContext;
};

export type UpdateQuantityOptions = SubscriptionChangePolicies & {
  quantity: number;
  itemId?: string;
  authorization?: AuthorizationContext;
};

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

  pauseSubscription(
    policy: PauseSubscriptionPolicy,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    return new PauseSubscriptionAction(this.deps).handle(
      this.billable,
      this.name,
      policy,
      authorization,
    );
  }

  resumePausedSubscription(
    policy: ResumePausedSubscriptionPolicy,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    return new ResumePausedSubscriptionAction(this.deps).handle(
      this.billable,
      this.name,
      policy,
      authorization,
    );
  }

  pausePaymentCollection(
    policy: PausePaymentCollectionPolicy,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    return new PausePaymentCollectionAction(this.deps).handle(
      this.billable,
      this.name,
      policy,
      authorization,
    );
  }

  resumePaymentCollection(authorization?: AuthorizationContext): Promise<Subscription> {
    return new ResumePaymentCollectionAction(this.deps).handle(
      this.billable,
      this.name,
      authorization,
    );
  }

  cancelScheduledSubscriptionChange(authorization?: AuthorizationContext): Promise<Subscription> {
    return new CancelScheduledSubscriptionChangeAction(this.deps).handle(
      this.billable,
      this.name,
      authorization,
    );
  }

  updateQuantity(quantity: number, authorization?: AuthorizationContext): Promise<Subscription>;
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
