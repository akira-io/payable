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
    const event = await this.deps.storage.webhookEvents.findById(
      payload.webhookEventId,
      payload.tenantId,
    );
    if (!event) {
      throw new PayableError(`Webhook event not found: ${payload.webhookEventId}`, {
        code: 'WEBHOOK_EVENT_NOT_FOUND',
      });
    }
    if (event.status === 'processed') {
      return;
    }
    const claimToken = await this.deps.storage.webhookEvents.claim(
      payload.webhookEventId,
      payload.tenantId,
    );
    if (!claimToken) {
      return;
    }
    const verified: VerifiedWebhook = {
      providerEventId: event.providerEventId,
      type: event.type,
      normalizedType: event.normalizedType as NormalizedEventName | null,
      data: event.data,
    };
    try {
      await new ProcessWebhookPipeline(this.deps).handle({
        verified,
        webhookEventId: payload.webhookEventId,
        correlationId: payload.correlationId,
        tenantId: payload.tenantId,
        claimToken,
      });
    } catch (error) {
      if (error instanceof PayableError && error.code === 'WEBHOOK_CLAIM_LOST') {
        return;
      }
      await this.deps.storage.webhookEvents
        .markStatus(payload.webhookEventId, 'failed', null, payload.tenantId, claimToken)
        .catch(() => {});
      throw error;
    }
  }
}
