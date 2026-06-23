import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import type { NormalizedEventName } from '../../../domain/events/domain-event';
import type { WebhookDependencies } from '../../builders/webhook-dependencies';
import { ProcessWebhookPipeline } from '../../pipelines/webhooks/process-webhook.pipeline';

export const PROCESS_WEBHOOK_JOB = 'webhook.process';

export interface ProcessWebhookJobPayload {
  providerName: string;
  webhookEventId: string;
  providerEventId: string;
  correlationId: string;
  tenantId: string | null;
}

export class ProcessWebhookAction {
  constructor(private readonly deps: WebhookDependencies) {}

  async handle(payload: ProcessWebhookJobPayload): Promise<void> {
    const event = await this.deps.storage.webhookEvents.findById(payload.webhookEventId);
    if (!event) {
      throw new PayableError(`Webhook event not found: ${payload.webhookEventId}`, {
        code: 'WEBHOOK_EVENT_NOT_FOUND',
      });
    }
    const verified: VerifiedWebhook = {
      providerEventId: event.providerEventId,
      type: event.type,
      normalizedType: event.normalizedType as NormalizedEventName | null,
      data: event.data,
    };
    await new ProcessWebhookPipeline(this.deps).handle({
      verified,
      webhookEventId: payload.webhookEventId,
      correlationId: payload.correlationId,
      tenantId: payload.tenantId,
    });
  }
}
