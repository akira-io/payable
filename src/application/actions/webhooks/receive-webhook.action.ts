import type { WebhookDependencies } from '../../builders/webhook-dependencies';
import { ProcessWebhookPipeline } from '../../pipelines/webhooks/process-webhook.pipeline';
import { StoreWebhookEventAction } from './store-webhook-event.action';

export interface ReceiveWebhookInput {
  payload: string;
  signature: string;
  headers?: Record<string, string>;
}

export interface ReceiveWebhookResult {
  webhookEventId: string;
  duplicate: boolean;
}

export class ReceiveWebhookAction {
  constructor(private readonly deps: WebhookDependencies) {}

  async handle(input: ReceiveWebhookInput): Promise<ReceiveWebhookResult> {
    const verified = await this.deps.provider.verifyWebhook({
      payload: input.payload,
      signature: input.signature,
      headers: input.headers,
    });
    const stored = await new StoreWebhookEventAction(this.deps).handle({
      verified,
      payload: input.payload,
      headers: input.headers,
    });
    if (stored.duplicate) {
      return { webhookEventId: stored.id, duplicate: true };
    }
    await new ProcessWebhookPipeline(this.deps).handle({
      verified,
      webhookEventId: stored.id,
      correlationId: stored.correlationId,
    });
    return { webhookEventId: stored.id, duplicate: false };
  }
}
