import { isWebhookCapable } from '../../../domain/contracts/payment-provider.contract';
import type { WebhookEventStatus } from '../../../domain/entities/webhook-event.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
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
  status: WebhookEventStatus;
}

export class ReceiveWebhookAction {
  constructor(private readonly deps: WebhookDependencies) {}

  async handle(input: ReceiveWebhookInput): Promise<ReceiveWebhookResult> {
    const provider = this.deps.provider;
    if (!isWebhookCapable(provider)) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'webhooks');
    }
    const verified = await provider.verifyWebhook({
      payload: input.payload,
      signature: input.signature,
      headers: input.headers,
    });
    const tenantId = await this.resolveTenant(input);
    if (this.deps.tenantEnabled && (tenantId === undefined || tenantId === null)) {
      throw new PayableError('A tenant id is required when tenancy is enabled', {
        code: 'TENANT_REQUIRED',
      });
    }
    const stored = await new StoreWebhookEventAction(this.deps).handle({
      verified,
      payload: input.payload,
      signature: input.signature,
      headers: input.headers,
      tenantId,
    });
    const reprocessable = stored.status === 'pending' || stored.status === 'failed';
    if (stored.duplicate && !reprocessable) {
      return { webhookEventId: stored.id, duplicate: true, status: stored.status };
    }
    await new DispatchWebhookJobAction(this.deps.queue).handle({
      providerName: this.deps.providerName,
      webhookEventId: stored.id,
      providerEventId: verified.providerEventId,
      correlationId: stored.correlationId,
      tenantId,
    });
    const settled = await this.deps.storage.webhookEvents.findById(stored.id, tenantId);
    const status = settled?.status ?? stored.status;
    if (status === 'failed') {
      throw new PayableError(`Webhook processing failed: ${stored.id}`, {
        code: 'WEBHOOK_PROCESSING_FAILED',
        context: { webhookEventId: stored.id },
      });
    }
    return { webhookEventId: stored.id, duplicate: stored.duplicate, status };
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
