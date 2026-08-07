import type {
  CancelScheduledSubscriptionChangeInput,
  PausePaymentCollectionInput,
  PauseSubscriptionInput,
  ResumePausedSubscriptionInput,
  ResumePaymentCollectionInput,
} from '../../src/domain/contracts/subscription-lifecycle-provider.contract';
import type { OperationContext } from '../../src/domain/dtos/common.dto';
import type { SubscriptionDTO } from '../../src/domain/dtos/subscription.dto';
import {
  defineSubscriptionOperationCapabilities,
  NO_SUBSCRIPTION_OPERATIONS,
} from '../../src/domain/dtos/subscription-operation-capabilities.dto';
import { FakeProvider } from './fake-provider';

export class SubscriptionLifecycleProvider extends FakeProvider {
  pauseCalls = 0;
  failPause = false;

  override subscriptionOperationCapabilities() {
    return defineSubscriptionOperationCapabilities({
      ...super.subscriptionOperationCapabilities(),
      pause: {
        subscription: {
          effectiveTimings: ['immediate', 'nextRenewal'],
          scheduledResume: true,
          resumeBillingPolicies: ['startNewBillingPeriod', 'continueExistingBillingPeriod'],
        },
        paymentCollection: {
          behaviors: ['keepAsDraft', 'markUncollectible', 'void'],
          scheduledResume: true,
        },
      },
      resume: {
        ...NO_SUBSCRIPTION_OPERATIONS.resume,
        pendingCancellation: true,
        pausedSubscription: {
          effectiveTimings: ['immediate', 'scheduled'],
          billingPolicies: ['startNewBillingPeriod', 'continueExistingBillingPeriod'],
        },
        paymentCollection: true,
      },
      scheduledChange: { cancel: true },
    });
  }

  async pauseSubscription(input: PauseSubscriptionInput): Promise<SubscriptionDTO> {
    this.pauseCalls += 1;
    if (this.failPause) throw new Error('provider pause failed');
    return {
      providerSubscriptionId: input.providerSubscriptionId,
      status: input.effectiveTiming === 'immediate' ? 'paused' : 'active',
      currentPeriodEnd: null,
      trialEndsAt: null,
      scheduledChangeAction: input.effectiveTiming === 'nextRenewal' ? 'pause' : null,
      scheduledChangeEffectiveAt:
        input.effectiveTiming === 'nextRenewal' ? new Date('2026-09-01T00:00:00.000Z') : null,
      scheduledResumeAt: input.resumeAt,
      resumeBillingPolicy: input.resumeBillingPolicy,
    };
  }

  async resumePausedSubscription(input: ResumePausedSubscriptionInput): Promise<SubscriptionDTO> {
    return {
      providerSubscriptionId: input.providerSubscriptionId,
      status: input.effectiveTiming === 'immediate' ? 'active' : 'paused',
      currentPeriodEnd: null,
      trialEndsAt: null,
      scheduledChangeAction: input.effectiveTiming === 'scheduled' ? 'resume' : null,
      scheduledChangeEffectiveAt: input.effectiveTiming === 'scheduled' ? input.effectiveAt : null,
      scheduledResumeAt: null,
      resumeBillingPolicy: input.billingPolicy,
    };
  }

  async pausePaymentCollection(input: PausePaymentCollectionInput): Promise<SubscriptionDTO> {
    return {
      providerSubscriptionId: input.providerSubscriptionId,
      status: 'active',
      currentPeriodEnd: null,
      trialEndsAt: null,
      paymentCollectionPauseBehavior: input.behavior,
      paymentCollectionResumesAt: input.resumesAt,
    };
  }

  async resumePaymentCollection(input: ResumePaymentCollectionInput): Promise<SubscriptionDTO> {
    return {
      providerSubscriptionId: input.providerSubscriptionId,
      status: 'active',
      currentPeriodEnd: null,
      trialEndsAt: null,
      paymentCollectionPauseBehavior: null,
      paymentCollectionResumesAt: null,
    };
  }

  async cancelScheduledSubscriptionChange(
    input: CancelScheduledSubscriptionChangeInput,
    _ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
    return {
      providerSubscriptionId: input.providerSubscriptionId,
      status: 'active',
      currentPeriodEnd: null,
      trialEndsAt: null,
      scheduledChangeAction: null,
      scheduledChangeEffectiveAt: null,
      scheduledResumeAt: null,
      resumeBillingPolicy: null,
    };
  }
}
