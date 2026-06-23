import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanResumeSubscriptionPolicy } from '../../policies/can-resume-subscription.policy';
import { SubscriptionAction } from './subscription-action';

export class ResumeSubscriptionAction extends SubscriptionAction {
  async handle(
    billable: Billable,
    name: string,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize(
      (context) => new CanResumeSubscriptionPolicy().authorize(context),
      authorization,
      'resume subscription',
    );
    const subscription = await this.resolve(billable, name);
    const dto = await this.deps.provider.resumeSubscription(
      { providerSubscriptionId: subscription.providerSubscriptionId },
      this.context('resume', subscription.providerSubscriptionId),
    );
    const updated = await this.storage().subscriptions.update(subscription.id, {
      status: dto.status,
      endsAt: null,
    });
    await this.audit({
      action: 'subscription.resumed',
      subscriptionId: subscription.id,
      before: { status: subscription.status, endsAt: subscription.endsAt ?? null },
      after: { status: updated.status, endsAt: updated.endsAt ?? null },
      authorization,
    });
    return updated;
  }
}
