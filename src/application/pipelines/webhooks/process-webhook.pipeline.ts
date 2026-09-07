import { isWebhookCapable } from '../../../domain/contracts/payment-provider.contract';
import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { WebhookProcessedEvent } from '../../../domain/events/webhook-processed.event';
import type { WebhookDependencies } from '../../builders/webhook-dependencies';
import { CatalogPriceReconciler } from '../../services/catalog-sync/catalog-price-reconciler';
import { CatalogReconciler } from '../../services/catalog-sync/catalog-reconciler';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';
import { reconcileWebhookPayment } from './reconcile-webhook-payment';
import { reconcileWebhookSubscription } from './reconcile-webhook-subscription';

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

    await this.reconcileCatalog(input.verified, tenantId);

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

  private async reconcileCatalog(
    verified: VerifiedWebhook,
    tenantId: string | null,
  ): Promise<void> {
    const providerResourceId = typeof verified.data.id === 'string' ? verified.data.id : null;
    if (!providerResourceId) return;
    const dependencies = { ...this.deps, tenantId };
    if (CATALOG_PRODUCT_EVENTS.has(verified.type)) {
      const binding = await this.deps.storage.productProviderBindings?.findByProviderId(
        this.deps.providerName,
        providerResourceId,
        tenantId,
      );
      if (binding) await new CatalogReconciler(dependencies).product(binding.productId, 'webhook');
      return;
    }
    if (CATALOG_PRICE_EVENTS.has(verified.type)) {
      const binding = await this.deps.storage.priceProviderBindings?.findByProviderId(
        this.deps.providerName,
        providerResourceId,
        tenantId,
      );
      if (binding) await new CatalogPriceReconciler(dependencies).price(binding.priceId, 'webhook');
    }
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
    const reconciliation = { deps: this.deps, repos, verified, occurredAt, tenantId };
    await reconcileWebhookPayment(reconciliation);
    await reconcileWebhookSubscription(reconciliation);
  }
}

const CATALOG_PRODUCT_EVENTS = new Set(['product.created', 'product.updated', 'product.deleted']);
const CATALOG_PRICE_EVENTS = new Set(['price.created', 'price.updated', 'price.deleted']);
