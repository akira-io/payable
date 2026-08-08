import {
  isPaymentWebhookCapable,
  isWebhookCapable,
} from '../../../domain/contracts/payment-provider.contract';
import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { SubscriptionPatch } from '../../../domain/contracts/subscription-repository.contract';
import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { WebhookProcessedEvent } from '../../../domain/events/webhook-processed.event';
import { PaymentStateMachine } from '../../../domain/states/payment-state-machine';
import { reconcileSubscriptionStatus } from '../../../domain/states/subscription-state-machine';
import type { WebhookDependencies } from '../../builders/webhook-dependencies';
import { CatalogPriceReconciler } from '../../services/catalog-sync/catalog-price-reconciler';
import { CatalogReconciler } from '../../services/catalog-sync/catalog-reconciler';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';
import { reconcileProviderSubscriptionItems } from '../../services/subscriptions/reconcile-provider-subscription-items';

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
    const dto = provider.reconcileSubscriptionAsync
      ? await provider.reconcileSubscriptionAsync(verified)
      : provider.reconcileSubscription(verified);
    if (!dto) {
      return;
    }
    const subscriptionBinding = await repos.subscriptionProviderBindings.findByProviderId(
      providerName,
      dto.providerSubscriptionId,
      tenantId,
    );
    const local = subscriptionBinding
      ? await repos.subscriptions.findById(subscriptionBinding.subscriptionId, tenantId)
      : await repos.subscriptions.findByProviderId(
          providerName,
          dto.providerSubscriptionId,
          tenantId,
        );
    if (!local) {
      return;
    }
    const providerOccurredAt = verified.occurredAt ?? null;
    const lastProviderSyncedAt =
      subscriptionBinding?.providerSyncedAt ?? local.providerSyncedAt ?? null;
    if (
      providerOccurredAt &&
      lastProviderSyncedAt &&
      providerOccurredAt.getTime() <= lastProviderSyncedAt.getTime()
    ) {
      return;
    }
    let singleItemPatch: Pick<SubscriptionPatch, 'priceId' | 'quantity'> | null = null;
    if (dto.items && !local.canonicalPriceId) {
      const localItems = await repos.subscriptionItems.listBySubscription(local.id, tenantId);
      const reconciliations = reconcileProviderSubscriptionItems(localItems, dto.items);
      for (const itemReconciliation of reconciliations) {
        await repos.subscriptionItems.updateById(
          local.id,
          itemReconciliation.itemId,
          {
            providerItemId: itemReconciliation.providerItemId,
            priceId: itemReconciliation.priceId,
            quantity: itemReconciliation.quantity,
          },
          tenantId,
        );
      }
      const [singleProviderItem] = dto.items;
      if (
        localItems.length === 1 &&
        dto.items.length === 1 &&
        reconciliations.length === 1 &&
        singleProviderItem
      ) {
        singleItemPatch = {
          priceId: singleProviderItem.priceId,
          quantity: singleProviderItem.quantity,
        };
      }
    }
    const reconciliation = reconcileSubscriptionStatus(local.status, dto.status);
    if (!reconciliation.applied) {
      return;
    }
    const status = reconciliation.status;
    const completedScheduledLifecycleChange =
      status === 'active' &&
      dto.scheduledChangeAction === null &&
      dto.scheduledChangeEffectiveAt === null &&
      dto.scheduledResumeAt === null;
    const patch: SubscriptionPatch = {
      status,
      ...(local.canonicalPriceId ? {} : (singleItemPatch ?? {})),
      currentPeriodEnd: dto.currentPeriodEnd,
      trialEndsAt: dto.trialEndsAt,
      ...(providerOccurredAt &&
      (!subscriptionBinding || (local.provider !== null && local.providerSubscriptionId !== null))
        ? { providerSyncedAt: providerOccurredAt }
        : {}),
      ...(status === 'canceled' ? { endsAt: dto.currentPeriodEnd ?? occurredAt } : {}),
      ...(dto.scheduledChangeAction !== undefined
        ? { scheduledChangeAction: dto.scheduledChangeAction }
        : {}),
      ...(dto.scheduledChangeEffectiveAt !== undefined
        ? { scheduledChangeEffectiveAt: dto.scheduledChangeEffectiveAt }
        : {}),
      ...(dto.scheduledResumeAt !== undefined ? { scheduledResumeAt: dto.scheduledResumeAt } : {}),
      ...(dto.resumeBillingPolicy !== undefined
        ? { resumeBillingPolicy: dto.resumeBillingPolicy }
        : completedScheduledLifecycleChange
          ? { resumeBillingPolicy: null }
          : {}),
      ...(dto.paymentCollectionPauseBehavior !== undefined
        ? { paymentCollectionPauseBehavior: dto.paymentCollectionPauseBehavior }
        : {}),
      ...(dto.paymentCollectionResumesAt !== undefined
        ? { paymentCollectionResumesAt: dto.paymentCollectionResumesAt }
        : {}),
    };
    await repos.subscriptions.update(local.id, patch, tenantId);
    if (providerOccurredAt && subscriptionBinding) {
      await repos.subscriptionProviderBindings.updateProviderSyncedAt(
        subscriptionBinding.id,
        providerOccurredAt,
        tenantId,
      );
    }
  }
}

const CATALOG_PRODUCT_EVENTS = new Set(['product.created', 'product.updated', 'product.deleted']);
const CATALOG_PRICE_EVENTS = new Set(['price.created', 'price.updated', 'price.deleted']);
