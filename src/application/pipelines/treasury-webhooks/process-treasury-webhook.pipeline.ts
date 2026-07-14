import type { VerifiedTreasuryWebhook } from '../../../domain/dtos/treasury-webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { TreasuryWebhookProcessedEvent } from '../../../domain/events/treasury-webhook-processed.event';
import type { TreasuryWebhookDependencies } from '../../builders/treasury-webhook-dependencies';

export interface ProcessTreasuryWebhookInput {
  verified: VerifiedTreasuryWebhook;
  webhookEventId: string;
  correlationId: string;
  tenantId?: string | null;
  claimToken?: string | null;
}

export class ProcessTreasuryWebhookPipeline {
  constructor(private readonly deps: TreasuryWebhookDependencies) {}

  async handle(input: ProcessTreasuryWebhookInput): Promise<void> {
    const { storage, events, clock, providerName } = this.deps;
    const processedAt = clock.now();
    const tenantId = input.tenantId ?? null;
    await storage.transaction(async (repos) => {
      await repos.auditLogs.create({
        tenantId,
        correlationId: input.correlationId,
        actorType: 'provider',
        actorId: providerName,
        action: `treasury.webhook.${input.verified.type}`,
        resourceType: 'webhook_event',
        resourceId: input.webhookEventId,
        before: null,
        after: input.verified.data,
        metadata: { normalizedType: input.verified.normalizedType },
        ipAddress: null,
        userAgent: null,
      });
      if (input.verified.normalizedType) {
        await repos.outboxEvents.create({
          tenantId,
          correlationId: input.correlationId,
          eventType: `${input.verified.normalizedType}.v1`,
          eventVersion: 1,
          payload: { providerEventId: input.verified.providerEventId, data: input.verified.data },
          dedupeKey: `treasury-webhook:${input.webhookEventId}:${input.verified.normalizedType}`,
        });
      }
      const marked = await repos.webhookEvents.markStatus(
        input.webhookEventId,
        'processed',
        processedAt,
        tenantId,
        input.claimToken,
      );
      if (input.claimToken != null && marked === null) {
        throw new PayableError('Treasury webhook claim lost before marking processed', {
          code: 'WEBHOOK_CLAIM_LOST',
          context: { webhookEventId: input.webhookEventId },
        });
      }
    });
    await events
      .emit(
        new TreasuryWebhookProcessedEvent(
          {
            webhookEventId: input.webhookEventId,
            provider: providerName,
            providerEventId: input.verified.providerEventId,
          },
          { correlationId: input.correlationId, occurredAt: processedAt },
        ),
      )
      .catch(() => {});
  }
}
