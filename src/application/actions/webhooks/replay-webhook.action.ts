import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import type { NormalizedEventName } from '../../../domain/events/domain-event';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { WebhookDependencies } from '../../builders/webhook-dependencies';
import { ProcessWebhookPipeline } from '../../pipelines/webhooks/process-webhook.pipeline';
import {
  CanReplayWebhookPolicy,
  type ReplayWebhookContext,
} from '../../policies/can-replay-webhook.policy';

export class ReplayWebhookAction {
  constructor(
    private readonly deps: WebhookDependencies,
    private readonly policy = new CanReplayWebhookPolicy(),
  ) {}

  async handle(webhookEventId: string, context: ReplayWebhookContext = {}): Promise<void> {
    if (!this.policy.authorize(context)) {
      throw new PayableError('Webhook replay not permitted', { code: 'WEBHOOK_REPLAY_DENIED' });
    }
    const event = await this.deps.storage.webhookEvents.findById(webhookEventId, context.tenantId);
    if (!event) {
      throw new PayableError(`Webhook event not found: ${webhookEventId}`, {
        code: 'WEBHOOK_EVENT_NOT_FOUND',
      });
    }
    if ((event.tenantId ?? null) !== (context.tenantId ?? null)) {
      throw new PayableError('Webhook replay not permitted', { code: 'WEBHOOK_REPLAY_DENIED' });
    }
    const verified: VerifiedWebhook = {
      providerEventId: event.providerEventId,
      type: event.type,
      normalizedType: event.normalizedType as NormalizedEventName | null,
      data: event.data,
    };
    await this.deps.storage.webhookEvents.markStatus(event.id, 'pending', null);
    const claimed = await this.deps.storage.webhookEvents.claim(event.id, context.tenantId);
    if (!claimed) {
      return;
    }
    try {
      await new ProcessWebhookPipeline(this.deps).handle({
        verified,
        webhookEventId: event.id,
        correlationId: CorrelationId.generate().toString(),
        tenantId: event.tenantId,
      });
    } catch (error) {
      await this.deps.storage.webhookEvents.markStatus(event.id, 'failed', null);
      throw error;
    }
  }
}
