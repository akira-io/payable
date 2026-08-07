import type {
  ApplySubscriptionChangeInput,
  SubscriptionChangePreview,
} from '../../../domain/dtos/subscription-change.dto';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import { SubscriptionChangePreviewError } from '../../../domain/errors/subscription-change-preview.error';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
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
    const preview = await this.previewStore().load(input.previewToken, tenantId);
    const subscription = await this.resolve(billable, name);
    if (
      preview.provider !== this.deps.provider.name ||
      preview.subscriptionId !== subscription.id
    ) {
      throw new SubscriptionChangePreviewError(
        'Subscription change preview does not belong to this subscription',
        'SUBSCRIPTION_CHANGE_PREVIEW_IMMUTABLE',
      );
    }
    const operation = this.changeOperation(preview);
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
        const providerInput = {
          providerSubscriptionId: subscription.providerSubscriptionId,
          currentItems: preview.currentItems,
          proposedItems: preview.proposedItems,
          effectiveTiming: preview.effectiveTiming,
          prorationPolicy: preview.prorationPolicy,
          paymentFailurePolicy: preview.paymentFailurePolicy,
          calculatedAt: preview.calculatedAt,
          renewalDate: preview.currentRenewalDate,
        };
        const providerSubscription = await provider.applySubscriptionChange(
          providerInput,
          this.context('change-apply', subscription.providerSubscriptionId, input.previewToken),
        );
        return this.persist(subscription, preview, providerSubscription.status, authorization);
      },
      revive: () => this.resolve(billable, name),
    });
  }

  private async persist(
    subscription: Awaited<ReturnType<SubscriptionAction['resolve']>>,
    preview: SubscriptionChangePreview,
    providerStatus: Subscription['status'],
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    return this.storage().transaction(async (repositories) => {
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
      const singleItem = preview.proposedItems.length === 1 ? preview.proposedItems[0] : undefined;
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
        after: { items: preview.proposedItems, previewToken: preview.previewToken },
        authorization,
      });
      return updated;
    });
  }

  private changeOperation(preview: SubscriptionChangePreview): 'changePrice' | 'changeQuantity' {
    const priceChanged = preview.proposedItems.some((proposedItem) => {
      const currentItem = preview.currentItems.find(
        (candidate) => candidate.itemId === proposedItem.itemId,
      );
      return currentItem?.priceId !== proposedItem.priceId;
    });
    return priceChanged ? 'changePrice' : 'changeQuantity';
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
