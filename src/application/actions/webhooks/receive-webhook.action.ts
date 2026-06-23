import type { WebhookDependencies } from '../../builders/webhook-dependencies';
import { DispatchWebhookJobAction } from './dispatch-webhook-job.action';
import { StoreWebhookEventAction } from './store-webhook-event.action';

export interface ReceiveWebhookInput {
  payload: string;
  signature: string;
  headers?: Record<string, string>;
  tenantId?: string | null;
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
    const tenantId = await this.resolveTenant(input);
    const stored = await new StoreWebhookEventAction(this.deps).handle({
      verified,
      payload: input.payload,
      headers: input.headers,
      tenantId,
    });
    if (stored.duplicate) {
      return { webhookEventId: stored.id, duplicate: true };
    }
    await new DispatchWebhookJobAction(this.deps.queue).handle({
      providerName: this.deps.providerName,
      webhookEventId: stored.id,
      providerEventId: verified.providerEventId,
      correlationId: stored.correlationId,
      tenantId,
    });
    return { webhookEventId: stored.id, duplicate: false };
  }

  private async resolveTenant(input: ReceiveWebhookInput): Promise<string | null> {
    if (input.tenantId !== undefined) {
      return input.tenantId;
    }
    const resolver = this.deps.tenantResolver;
    if (!resolver) {
      return null;
    }
    return resolver.resolve({
      provider: this.deps.providerName,
      headers: input.headers ?? {},
      payload: input.payload,
    });
  }
}
