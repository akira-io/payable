import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { NewSubscription } from '../../../domain/contracts/subscription-repository.contract';
import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import { WebhookProcessedEvent } from '../../../domain/events/webhook-processed.event';
import { reconcileSubscriptionStatus } from '../../../domain/states/subscription-state-machine';
import type { WebhookDependencies } from '../../builders/webhook-dependencies';

export interface ProcessWebhookInput {
  verified: VerifiedWebhook;
  webhookEventId: string;
  correlationId: string;
  tenantId?: string | null;
}

export class ProcessWebhookPipeline {
  constructor(private readonly deps: WebhookDependencies) {}

  async handle(input: ProcessWebhookInput): Promise<void> {
    const { storage, events, clock, providerName } = this.deps;
    const occurredAt = clock.now();
    const tenantId = input.tenantId ?? null;

    await storage.transaction(async (repos) => {
      await this.reconcile(repos, input.verified, occurredAt, tenantId);

      await repos.auditLogs.create({
        tenantId,
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
        await repos.outboxEvents.create({
          tenantId,
          correlationId: input.correlationId,
          eventType: `${input.verified.normalizedType}.v1`,
          eventVersion: 1,
          payload: { providerEventId: input.verified.providerEventId, data: input.verified.data },
        });
      }

      await repos.webhookEvents.markStatus(input.webhookEventId, 'processed', occurredAt, tenantId);
    });

    await events
      .emit(
        new WebhookProcessedEvent(
          {
            webhookEventId: input.webhookEventId,
            provider: providerName,
            providerEventId: input.verified.providerEventId,
          },
          { correlationId: input.correlationId, occurredAt },
        ),
      )
      .catch(() => {});
  }

  private async reconcile(
    repos: Repositories,
    verified: VerifiedWebhook,
    occurredAt: Date,
    tenantId: string | null,
  ): Promise<void> {
    const { provider, providerName } = this.deps;
    const dto = provider.reconcileSubscription(verified);
    if (!dto) {
      return;
    }
    const local = await repos.subscriptions.findByProviderId(
      providerName,
      dto.providerSubscriptionId,
      tenantId,
    );
    if (!local) {
      return;
    }
    const status = reconcileSubscriptionStatus(local.status, dto.status).status;
    const patch: Partial<NewSubscription> = {
      status,
      currentPeriodEnd: dto.currentPeriodEnd,
      trialEndsAt: dto.trialEndsAt,
      ...(status === 'canceled' ? { endsAt: dto.currentPeriodEnd ?? occurredAt } : {}),
    };
    await repos.subscriptions.update(local.id, patch, tenantId);
  }
}
