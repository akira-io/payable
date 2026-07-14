import type { TreasuryWebhookEventType } from '../../../domain/dtos/treasury-webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import type { TreasuryWebhookDependencies } from '../../builders/treasury-webhook-dependencies';
import { ProcessTreasuryWebhookPipeline } from '../../pipelines/treasury-webhooks/process-treasury-webhook.pipeline';

export const PROCESS_TREASURY_WEBHOOK_JOB = 'payable.treasury-webhook.process';

export interface ProcessTreasuryWebhookJobPayload {
  providerName: string;
  webhookEventId: string;
  providerEventId: string;
  correlationId: string;
  tenantId: string | null;
}

export class ProcessTreasuryWebhookAction {
  constructor(private readonly deps: TreasuryWebhookDependencies) {}

  async handle(payload: ProcessTreasuryWebhookJobPayload): Promise<void> {
    const event = await this.deps.storage.webhookEvents.findById(
      payload.webhookEventId,
      payload.tenantId,
    );
    if (!event) {
      throw new PayableError(`Treasury webhook event not found: ${payload.webhookEventId}`, {
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
    try {
      await new ProcessTreasuryWebhookPipeline(this.deps).handle({
        verified: {
          providerEventId: event.providerEventId,
          type: event.type,
          normalizedType: event.normalizedType as TreasuryWebhookEventType | null,
          occurredAt: null,
          data: event.data,
        },
        webhookEventId: event.id,
        correlationId: event.correlationId,
        tenantId: payload.tenantId,
        claimToken,
      });
    } catch (error) {
      if (error instanceof PayableError && error.code === 'WEBHOOK_CLAIM_LOST') {
        return;
      }
      await this.deps.storage.webhookEvents
        .markStatus(event.id, 'failed', null, payload.tenantId, claimToken)
        .catch(() => {});
      throw error;
    }
  }
}
