import {
  isPausedSubscriptionResumeCapable,
  type PausedSubscriptionResumeCapable,
} from '../../../domain/contracts/subscription-lifecycle-provider.contract';
import {
  type ResumePausedSubscriptionPolicy,
  validateResumePausedSubscriptionPolicy,
} from '../../../domain/dtos/subscription-pause-policy.dto';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanResumeSubscriptionPolicy } from '../../policies/can-resume-subscription.policy';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';
import { assertResumePausedSubscriptionPolicySupported } from '../../services/provider-capabilities/assert-subscription-operation';
import { SubscriptionAction } from './subscription-action';

export class ResumePausedSubscriptionAction extends SubscriptionAction {
  async handle(
    billable: Billable,
    name: string,
    policy: ResumePausedSubscriptionPolicy,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize(
      (context) => new CanResumeSubscriptionPolicy().authorize(context),
      authorization,
      'resume paused subscription',
    );
    validateResumePausedSubscriptionPolicy(policy, this.deps.clock.now());
    const provider = this.deps.provider;
    assertCapableProvider<PausedSubscriptionResumeCapable>(
      provider,
      'subscriptions',
      isPausedSubscriptionResumeCapable,
    );
    assertResumePausedSubscriptionPolicySupported(provider, policy);
    const subscription = await this.resolve(billable, name);
    const dto = await provider.resumePausedSubscription(
      { providerSubscriptionId: subscription.providerSubscriptionId, ...policy },
      this.context('resume-paused', subscription.providerSubscriptionId, JSON.stringify(policy)),
    );
    return this.storage().transaction(async (repos) => {
      const updated = await repos.subscriptions.update(
        subscription.id,
        this.lifecyclePatch(subscription, dto),
        this.deps.tenantId ?? null,
      );
      await this.auditWith(repos, {
        action:
          dto.scheduledChangeAction === 'resume'
            ? 'subscription.resume_scheduled'
            : 'subscription.resumed_from_pause',
        subscriptionId: subscription.id,
        before: this.lifecycleSnapshot(subscription),
        after: this.lifecycleSnapshot(updated),
        authorization,
      });
      return updated;
    });
  }
}
