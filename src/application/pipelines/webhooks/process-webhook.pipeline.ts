import type { NewSubscription } from '../../../domain/contracts/subscription-repository.contract';
import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import { WebhookProcessedEvent } from '../../../domain/events/webhook-processed.event';
import type { WebhookDependencies } from '../../builders/webhook-dependencies';

export interface ProcessWebhookInput {
  verified: VerifiedWebhook;
  webhookEventId: string;
  correlationId: string;
}

export class ProcessWebhookPipeline {
  constructor(private readonly deps: WebhookDependencies) {}

  async handle(input: ProcessWebhookInput): Promise<void> {
    const { storage, events, clock, providerName } = this.deps;
    const occurredAt = clock.now();

    await this.reconcile(input.verified, occurredAt);

    await storage.auditLogs.create({
      tenantId: null,
      correlationId: input.correlationId,
      actorType: 'provider',
      actorId: providerName,
      action: `webhook.${input.verified.type}`,
      resourceType: 'webhook_event',
      resourceId: input.webhookEventId,
      before: null,
      after: input.verified.data,
      metadata: { normalizedType: input.verified.normalizedType },
      ipAddress: null,
      userAgent: null,
    });

    if (input.verified.normalizedType) {
      await storage.outboxEvents.create({
        tenantId: null,
        correlationId: input.correlationId,
        eventType: `${input.verified.normalizedType}.v1`,
        eventVersion: 1,
        payload: { providerEventId: input.verified.providerEventId, data: input.verified.data },
      });
    }

    await storage.webhookEvents.markStatus(input.webhookEventId, 'processed', occurredAt);

    await events.emit(
      new WebhookProcessedEvent(
        {
          webhookEventId: input.webhookEventId,
          provider: providerName,
          providerEventId: input.verified.providerEventId,
        },
        { correlationId: input.correlationId, occurredAt },
      ),
    );
  }

  private async reconcile(verified: VerifiedWebhook, occurredAt: Date): Promise<void> {
    const { storage, provider, providerName } = this.deps;
    const dto = provider.reconcileSubscription(verified);
    if (!dto) {
      return;
    }
    const local = await storage.subscriptions.findByProviderId(
      providerName,
      dto.providerSubscriptionId,
    );
    if (!local) {
      return;
    }
    const patch: Partial<NewSubscription> = {
      status: dto.status,
      currentPeriodEnd: dto.currentPeriodEnd,
      trialEndsAt: dto.trialEndsAt,
      ...(dto.status === 'canceled' ? { endsAt: dto.currentPeriodEnd ?? occurredAt } : {}),
    };
    await storage.subscriptions.update(local.id, patch);
  }
}
