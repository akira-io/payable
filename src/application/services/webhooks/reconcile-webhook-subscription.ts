import { isWebhookCapable } from '../../../domain/contracts/payment-provider.contract';
import type { SubscriptionPatch } from '../../../domain/contracts/subscription-repository.contract';
import { reconcileSubscriptionStatus } from '../../../domain/states/subscription-state-machine';
import { assertCapableProvider } from '../provider-capabilities/assert-provider-capability';
import { reconcileProviderSubscriptionItems } from '../subscriptions/reconcile-provider-subscription-items';
import type { WebhookReconciliationContext } from './webhook-reconciliation-context';

export async function reconcileWebhookSubscription({
  deps,
  repos,
  verified,
  occurredAt,
  tenantId,
}: WebhookReconciliationContext): Promise<void> {
  const { provider, providerName } = deps;
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
