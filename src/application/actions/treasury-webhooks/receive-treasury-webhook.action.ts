import { isTreasuryWebhookCapable } from '../../../domain/contracts/treasury-provider.contract';
import { PayableError } from '../../../domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import type { TreasuryWebhookDependencies } from '../../builders/treasury-webhook-dependencies';
import type { ReceiveWebhookInput, ReceiveWebhookResult } from '../webhooks/receive-webhook.action';
import { StoreWebhookEventAction } from '../webhooks/store-webhook-event.action';
import {
  PROCESS_TREASURY_WEBHOOK_JOB,
  type ProcessTreasuryWebhookJobPayload,
} from './process-treasury-webhook.action';

export type ReceiveTreasuryWebhookInput = ReceiveWebhookInput;

export class ReceiveTreasuryWebhookAction {
  constructor(private readonly deps: TreasuryWebhookDependencies) {}

  async handle(input: ReceiveTreasuryWebhookInput): Promise<ReceiveWebhookResult> {
    const provider = this.deps.provider;
    if (!provider.capabilities().has('webhooks') || !isTreasuryWebhookCapable(provider)) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'webhooks');
    }
    const verified = await provider.verifyTreasuryWebhook(input);
    const tenantId = await this.resolveTenant(input);
    if (this.deps.tenantEnabled && tenantId == null) {
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
    const payload: ProcessTreasuryWebhookJobPayload = {
      providerName: this.deps.providerName,
      webhookEventId: stored.id,
      providerEventId: verified.providerEventId,
      correlationId: stored.correlationId,
      tenantId,
    };
    await this.deps.queue.dispatch({
      name: PROCESS_TREASURY_WEBHOOK_JOB,
      payload,
      correlationId: stored.correlationId,
      idempotencyKey: stored.id,
    });
    if (!this.deps.queue.inline) {
      return { webhookEventId: stored.id, duplicate: stored.duplicate, status: stored.status };
    }
    const settled = await this.deps.storage.webhookEvents.findById(stored.id, tenantId);
    const status = settled?.status ?? stored.status;
    if (status === 'failed') {
      throw new PayableError(`Treasury webhook processing failed: ${stored.id}`, {
        code: 'TREASURY_WEBHOOK_PROCESSING_FAILED',
        context: { webhookEventId: stored.id },
      });
    }
    return { webhookEventId: stored.id, duplicate: stored.duplicate, status };
  }

  private async resolveTenant(input: ReceiveTreasuryWebhookInput): Promise<string | null> {
    if (input.tenantId !== undefined) {
      return input.tenantId;
    }
    if (!this.deps.tenantResolver) {
      return null;
    }
    return this.deps.tenantResolver.resolve({
      provider: this.deps.providerName,
      headers: input.headers ?? {},
      payload: input.payload,
    });
  }
}
