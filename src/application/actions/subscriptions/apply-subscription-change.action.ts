import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type {
  ApplySubscriptionChangeInput,
  SubscriptionChangeItem,
  SubscriptionChangePreview,
} from '../../../domain/dtos/subscription-change.dto';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { SubscriptionChangePreviewError } from '../../../domain/errors/subscription-change-preview.error';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
import { applyCompatibleSubscriptionChange } from '../../services/subscriptions/apply-compatible-subscription-change';
import { migrationIdFromLegacyPreviewToken } from '../../services/subscriptions/subscription-change-migration-compatibility';
import { subscriptionChangeOperation } from '../../services/subscriptions/subscription-change-operation';
import { SubscriptionAction } from './subscription-action';

export class ApplySubscriptionChangeAction extends SubscriptionAction {
  constructor(
    deps: BillingDependencies,
    private readonly policy = new CanUpdateSubscriptionPolicy(),
  ) {
    super(deps);
  }

  async handle(
    billable: Billable,
    name: string,
    input: ApplySubscriptionChangeInput,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize(
      (context) => this.policy.authorize(context),
      authorization,
      'apply subscription change',
    );
    const tenantId = this.deps.tenantId ?? null;
    const migrationId = migrationIdFromLegacyPreviewToken(input.previewToken);
    const migration = migrationId
      ? await this.deps.storage?.subscriptionPriceMigrations.findById(migrationId, tenantId)
      : null;
    if (migration) {
      return this.applyCanonical(billable, name, migration, input, authorization);
    }
    const preview = await this.previewStore().load(input.previewToken, tenantId);
    const subscription = await this.resolve(billable, name);
    await this.assertNoActiveMigration(subscription.id);
    if (
      preview.provider !== this.deps.provider.name ||
      preview.subscriptionId !== subscription.id
    ) {
      throw new SubscriptionChangePreviewError(
        'Subscription change preview does not belong to this subscription',
        'SUBSCRIPTION_CHANGE_PREVIEW_IMMUTABLE',
      );
    }
    const operation = subscriptionChangeOperation(preview.currentItems, preview.proposedItems);
    const provider = this.subscriptionChangeProvider(operation);
    const idempotency = this.changeIdempotency();
    const key = IdempotencyKey.of(input.idempotencyKey).toString();
    return idempotency.execute({
      key,
      storageKey: `subscription-change-apply:${tenantId ?? ''}:${input.previewToken}`,
      scope: 'subscription-change-apply',
      operation: 'apply',
      request: preview,
      resourceType: 'subscription',
      resourceId: subscription.id,
      tenantId,
      failurePolicy: 'reconciliation-required',
      run: async () => {
        await this.assertCurrentItemsMatchPreview(subscription, preview);
        const providerInputBase = {
          providerSubscriptionId: subscription.providerSubscriptionId,
          currentItems: preview.currentItems,
          proposedItems: preview.proposedItems,
          prorationPolicy: preview.prorationPolicy,
          paymentFailurePolicy: preview.paymentFailurePolicy,
          calculatedAt: preview.calculatedAt,
          renewalDate: preview.currentRenewalDate,
        };
        const providerInput =
          preview.effectiveTiming === 'scheduled'
            ? {
                ...providerInputBase,
                effectiveTiming: preview.effectiveTiming,
                effectiveAt: preview.effectiveAt,
              }
            : { ...providerInputBase, effectiveTiming: preview.effectiveTiming };
        const context = this.context(
          'change-apply',
          subscription.providerSubscriptionId,
          input.previewToken,
        );
        return this.mutateSubscription({
          subscriptionId: subscription.id,
          operation: 'subscription_change_apply',
          context,
          callProvider: async () => ({
            kind: 'applied',
            value: await provider.applySubscriptionChange(providerInput, context),
          }),
          persist: (repositories, providerSubscription) =>
            this.persist(
              repositories,
              subscription,
              preview,
              providerSubscription.status,
              authorization,
            ),
        });
      },
      revive: () => this.resolve(billable, name),
    });
  }

  private async applyCanonical(
    billable: Billable,
    name: string,
    migration: SubscriptionPriceMigration,
    input: ApplySubscriptionChangeInput,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    if (migration.expiresAt.getTime() <= this.deps.clock.now().getTime()) {
      throw new SubscriptionChangePreviewError(
        'Subscription change preview has expired',
        'SUBSCRIPTION_CHANGE_PREVIEW_EXPIRED',
      );
    }
    const subscription = await this.resolve(billable, name);
    if (migration.subscriptionId !== subscription.id) {
      throw new SubscriptionChangePreviewError(
        'Subscription change preview does not belong to this subscription',
        'SUBSCRIPTION_CHANGE_PREVIEW_IMMUTABLE',
      );
    }
    await applyCompatibleSubscriptionChange(this.deps, migration, input, (preview) =>
      this.auditCanonicalApply(preview, authorization),
    );
    return this.resolve(billable, name);
  }

  private async auditCanonicalApply(
    preview: SubscriptionChangePreview,
    authorization?: AuthorizationContext,
  ): Promise<void> {
    const appliesImmediately = preview.effectiveTiming === 'immediate';
    await this.storage().transaction((repositories) =>
      this.auditWith(repositories, {
        action: 'subscription.change_applied',
        subscriptionId: preview.subscriptionId,
        before: { items: preview.currentItems },
        after: appliesImmediately
          ? {
              items: preview.proposedItems,
              previewToken: preview.previewToken,
              ...this.auditTiming(preview),
            }
          : {
              items: preview.currentItems,
              proposedItems: preview.proposedItems,
              previewToken: preview.previewToken,
              ...this.auditTiming(preview),
            },
        authorization,
      }),
    );
  }

  private async persist(
    repositories: Repositories,
    subscription: Awaited<ReturnType<SubscriptionAction['resolve']>>,
    preview: SubscriptionChangePreview,
    providerStatus: Subscription['status'],
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    const appliesImmediately = preview.effectiveTiming === 'immediate';
    if (appliesImmediately) {
      for (const proposedItem of preview.proposedItems) {
        const currentItem = preview.currentItems.find(
          (candidate) => candidate.itemId === proposedItem.itemId,
        );
        if (
          !currentItem ||
          (currentItem.priceId === proposedItem.priceId &&
            currentItem.quantity === proposedItem.quantity)
        ) {
          continue;
        }
        await repositories.subscriptionItems.updateById(
          subscription.id,
          proposedItem.itemId,
          { priceId: proposedItem.priceId, quantity: proposedItem.quantity },
          this.deps.tenantId ?? null,
        );
      }
    }
    const singleItem =
      appliesImmediately && preview.proposedItems.length === 1
        ? preview.proposedItems[0]
        : undefined;
    const updated = await repositories.subscriptions.update(
      subscription.id,
      {
        ...(singleItem ? { priceId: singleItem.priceId, quantity: singleItem.quantity } : {}),
        status: this.reconcileStatus(subscription.status, providerStatus),
      },
      this.deps.tenantId ?? null,
    );
    await this.auditWith(repositories, {
      action: 'subscription.change_applied',
      subscriptionId: subscription.id,
      before: { items: preview.currentItems },
      after: appliesImmediately
        ? {
            items: preview.proposedItems,
            previewToken: preview.previewToken,
            ...this.auditTiming(preview),
          }
        : {
            items: preview.currentItems,
            proposedItems: preview.proposedItems,
            previewToken: preview.previewToken,
            ...this.auditTiming(preview),
          },
      authorization,
    });
    return updated;
  }

  private auditTiming(preview: SubscriptionChangePreview): Record<string, string> {
    return preview.effectiveTiming === 'scheduled'
      ? { effectiveTiming: preview.effectiveTiming, effectiveAt: preview.effectiveAt.toISOString() }
      : { effectiveTiming: preview.effectiveTiming };
  }

  private async assertCurrentItemsMatchPreview(
    subscription: Awaited<ReturnType<SubscriptionAction['resolve']>>,
    preview: SubscriptionChangePreview,
  ): Promise<void> {
    const currentItems = await this.storage().subscriptionItems.listBySubscription(
      subscription.id,
      this.deps.tenantId ?? null,
    );
    const canonicalCurrentItems = currentItems.map((item) => ({
      itemId: item.id,
      providerItemId: item.providerItemId,
      priceId: item.priceId,
      quantity: item.quantity,
    }));
    if (!sameSubscriptionItems(canonicalCurrentItems, preview.currentItems)) {
      throw new SubscriptionChangePreviewError(
        'Subscription items changed after preview calculation',
        'SUBSCRIPTION_CHANGE_PREVIEW_STALE',
      );
    }
  }

  private changeIdempotency() {
    if (!this.deps.subscriptionChangeIdempotency) {
      throw new SubscriptionChangePreviewError(
        'Subscription changes require an idempotency store',
        'SUBSCRIPTION_CHANGE_PREVIEW_STORAGE_REQUIRED',
      );
    }
    return this.deps.subscriptionChangeIdempotency;
  }

  private previewStore() {
    if (!this.deps.subscriptionChangePreviews) {
      throw new SubscriptionChangePreviewError(
        'Subscription change previews require an idempotency store',
        'SUBSCRIPTION_CHANGE_PREVIEW_STORAGE_REQUIRED',
      );
    }
    return this.deps.subscriptionChangePreviews;
  }
}

function sameSubscriptionItems(
  currentItems: readonly SubscriptionChangeItem[],
  previewItems: readonly SubscriptionChangeItem[],
): boolean {
  if (currentItems.length !== previewItems.length) {
    return false;
  }
  const currentById = new Map(currentItems.map((item) => [item.itemId, item]));
  return previewItems.every((previewItem) => {
    const currentItem = currentById.get(previewItem.itemId);
    return (
      currentItem?.providerItemId === previewItem.providerItemId &&
      currentItem.priceId === previewItem.priceId &&
      currentItem.quantity === previewItem.quantity
    );
  });
}
