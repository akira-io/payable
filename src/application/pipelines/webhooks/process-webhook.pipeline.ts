import {
  isPaymentWebhookCapable,
  isWebhookCapable,
} from '../../../domain/contracts/payment-provider.contract';
import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { NewSubscription } from '../../../domain/contracts/subscription-repository.contract';
import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { WebhookProcessedEvent } from '../../../domain/events/webhook-processed.event';
import { PaymentStateMachine } from '../../../domain/states/payment-state-machine';
import { reconcileSubscriptionStatus } from '../../../domain/states/subscription-state-machine';
import type { WebhookDependencies } from '../../builders/webhook-dependencies';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';

export interface ProcessWebhookInput {
  verified: VerifiedWebhook;
  webhookEventId: string;
  correlationId: string;
  tenantId?: string | null;
  claimToken?: string | null;
}

export class ProcessWebhookPipeline {
  constructor(private readonly deps: WebhookDependencies) {}

  async handle(input: ProcessWebhookInput): Promise<void> {
    const { storage, events, clock, providerName } = this.deps;
    const processedAt = clock.now();
    const occurredAt = input.verified.occurredAt ?? processedAt;
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
        after: {
          providerEventId: input.verified.providerEventId,
          type: input.verified.type,
          normalizedType: input.verified.normalizedType,
        },
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
          dedupeKey: `webhook:${input.webhookEventId}:${input.verified.normalizedType}`,
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
        throw new PayableError('Webhook claim lost before marking processed', {
          code: 'WEBHOOK_CLAIM_LOST',
          context: { webhookEventId: input.webhookEventId },
        });
      }
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
    const { provider } = this.deps;
    if (!provider.capabilities().has('webhooks')) {
      return;
    }
    assertCapableProvider(provider, 'webhooks', isWebhookCapable);
    await this.reconcilePayment(repos, verified, tenantId);
    await this.reconcileSubscription(repos, verified, occurredAt, tenantId);
  }

  private async reconcilePayment(
    repos: Repositories,
    verified: VerifiedWebhook,
    tenantId: string | null,
  ): Promise<void> {
    const { provider, providerName } = this.deps;
    if (!isPaymentWebhookCapable(provider)) {
      return;
    }
    const dto = provider.reconcilePayment(verified);
    if (!dto) {
      return;
    }
    const local = await repos.payments.findByProviderId(
      providerName,
      dto.providerPaymentId,
      tenantId,
    );
    if (!local) {
      return;
    }
    const machine = new PaymentStateMachine(local.status);
    if (!machine.tryTransitionTo(dto.status)) {
      return;
    }
    await repos.payments.update(local.id, { status: machine.current() }, tenantId);
  }

  private async reconcileSubscription(
    repos: Repositories,
    verified: VerifiedWebhook,
    occurredAt: Date,
    tenantId: string | null,
  ): Promise<void> {
    const { provider, providerName } = this.deps;
    assertCapableProvider(provider, 'webhooks', isWebhookCapable);
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
    const providerOccurredAt = verified.occurredAt ?? null;
    if (
      providerOccurredAt &&
      local.providerSyncedAt &&
      providerOccurredAt.getTime() <= local.providerSyncedAt.getTime()
    ) {
      return;
    }
    const reconciliation = reconcileSubscriptionStatus(local.status, dto.status);
    if (!reconciliation.applied) {
      return;
    }
    const status = reconciliation.status;
    const patch: Partial<NewSubscription> = {
      status,
      currentPeriodEnd: dto.currentPeriodEnd,
      trialEndsAt: dto.trialEndsAt,
      ...(providerOccurredAt ? { providerSyncedAt: providerOccurredAt } : {}),
      ...(status === 'canceled' ? { endsAt: dto.currentPeriodEnd ?? occurredAt } : {}),
    };
    await repos.subscriptions.update(local.id, patch, tenantId);
  }
}
