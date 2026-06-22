import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import type { WebhookDependencies } from '../../builders/webhook-dependencies';
import { ProcessWebhookPipeline } from '../../pipelines/webhooks/process-webhook.pipeline';

export const PROCESS_WEBHOOK_JOB = 'webhook.process';

export interface ProcessWebhookJobPayload {
  providerName: string;
  webhookEventId: string;
  correlationId: string;
  verified: VerifiedWebhook;
}

export class ProcessWebhookAction {
  constructor(private readonly deps: WebhookDependencies) {}

  async handle(payload: ProcessWebhookJobPayload): Promise<void> {
    await new ProcessWebhookPipeline(this.deps).handle({
      verified: payload.verified,
      webhookEventId: payload.webhookEventId,
      correlationId: payload.correlationId,
    });
  }
}
