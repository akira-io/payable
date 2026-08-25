import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanResumeSubscriptionPolicy } from '../../policies/can-resume-subscription.policy';
import { SubscriptionAction } from './subscription-action';

export class ResumeSubscriptionAction extends SubscriptionAction {
  constructor(
    deps: BillingDependencies,
    private readonly policy = new CanResumeSubscriptionPolicy(),
  ) {
    super(deps);
  }

  async handle(
    billable: Billable,
    name: string,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize(
      (context) => this.policy.authorize(context),
      authorization,
      'resume subscription',
    );
    const provider = this.subscriptionProvider('resume');
    const subscription = await this.resolve(billable, name);
    await this.assertNoActiveMigration(subscription.id);
    const context = this.context('resume', subscription.providerSubscriptionId);
    return this.mutateSubscription({
      subscriptionId: subscription.id,
      operation: 'subscription_resume',
      context,
      callProvider: async () => ({
        kind: 'applied',
        value: await provider.resumeSubscription(
          { providerSubscriptionId: subscription.providerSubscriptionId },
          context,
        ),
      }),
      persist: async (repos, dto) => {
        const updated = await repos.subscriptions.update(
          subscription.id,
          {
            status: this.reconcileStatus(subscription.status, dto.status),
            endsAt: null,
          },
          this.deps.tenantId ?? null,
        );
        await this.auditWith(repos, {
          action: 'subscription.resumed',
          subscriptionId: subscription.id,
          before: { status: subscription.status, endsAt: subscription.endsAt ?? null },
          after: { status: updated.status, endsAt: updated.endsAt ?? null },
          authorization,
        });
        return updated;
      },
    });
  }
}
