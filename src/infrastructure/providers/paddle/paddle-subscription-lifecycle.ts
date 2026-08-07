import type {
  CancelScheduledSubscriptionChangeInput,
  PauseSubscriptionInput,
  ResumePausedSubscriptionInput,
} from '../../../domain/contracts/subscription-lifecycle-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import { withPaddleErrors } from './paddle-errors';
import { toSubscriptionDTO } from './paddle-mappers';
import type { PaddleClient } from './paddle-types';

export class PaddleSubscriptionLifecycle {
  constructor(private readonly client: () => Promise<PaddleClient>) {}

  async pause(input: PauseSubscriptionInput, _context: OperationContext): Promise<SubscriptionDTO> {
    const paddle = await this.client();
    const subscription = await withPaddleErrors(() =>
      paddle.subscriptions.pause(input.providerSubscriptionId, {
        effectiveFrom:
          input.effectiveTiming === 'immediate' ? 'immediately' : 'next_billing_period',
        resumeAt: input.resumeAt?.toISOString() ?? null,
        onResume:
          input.resumeBillingPolicy === 'startNewBillingPeriod'
            ? 'start_new_billing_period'
            : 'continue_existing_billing_period',
      }),
    );
    return {
      ...toSubscriptionDTO(subscription),
      resumeBillingPolicy: input.resumeBillingPolicy,
    };
  }

  async resume(
    input: ResumePausedSubscriptionInput,
    _context: OperationContext,
  ): Promise<SubscriptionDTO> {
    const paddle = await this.client();
    const subscription = await withPaddleErrors(() =>
      paddle.subscriptions.resume(input.providerSubscriptionId, {
        effectiveFrom:
          input.effectiveTiming === 'immediate' ? 'immediately' : input.effectiveAt.toISOString(),
        onResume:
          input.billingPolicy === 'startNewBillingPeriod'
            ? 'start_new_billing_period'
            : 'continue_existing_billing_period',
      }),
    );
    return { ...toSubscriptionDTO(subscription), resumeBillingPolicy: input.billingPolicy };
  }

  async cancelScheduledChange(
    input: CancelScheduledSubscriptionChangeInput,
    _context: OperationContext,
  ): Promise<SubscriptionDTO> {
    const paddle = await this.client();
    const subscription = await withPaddleErrors(() =>
      paddle.subscriptions.update(input.providerSubscriptionId, { scheduledChange: null }),
    );
    return toSubscriptionDTO(subscription);
  }
}
