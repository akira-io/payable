import type { SubscriptionChangePolicies } from '../../../domain/dtos/subscription-change.dto';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import { SubscriptionChangePreviewError } from '../../../domain/errors/subscription-change-preview.error';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
import { SubscriptionAction } from './subscription-action';

export class SwapSubscriptionAction extends SubscriptionAction {
  constructor(
    deps: BillingDependencies,
    private readonly policy = new CanUpdateSubscriptionPolicy(),
  ) {
    super(deps);
  }

  async handle(
    billable: Billable,
    name: string,
    priceId: string,
    authorization?: AuthorizationContext,
    itemId?: string,
    policies?: SubscriptionChangePolicies,
  ): Promise<Subscription> {
    this.authorize((context) => this.policy.authorize(context), authorization, 'swap subscription');
    if (!policies) {
      throw new SubscriptionChangePreviewError(
        'Subscription changes require explicit policies',
        'SUBSCRIPTION_CHANGE_POLICY_REQUIRED',
      );
    }
    const provider = this.subscriptionProvider('changePrice');
    const subscription = await this.resolve(billable, name);
    const selection = await this.selectItem(subscription, itemId);
    const providerItems = selection.items.map((subscriptionItem) => ({
      priceId:
        subscriptionItem.id === selection.selectedItem.id ? priceId : subscriptionItem.priceId,
      quantity: subscriptionItem.quantity,
    }));
    const dto = await provider.updateSubscription(
      {
        providerSubscriptionId: subscription.providerSubscriptionId,
        priceId,
        quantity: selection.selectedItem.quantity,
        providerItemId: selection.selectedItem.providerItemId,
        items: providerItems,
        ...policies,
        calculatedAt: this.deps.clock.now(),
      },
      this.context('swap', subscription.providerSubscriptionId, priceId, true),
    );
    return this.storage().transaction(async (repos) => {
      const patch = {
        ...(selection.items.length === 1 ? { priceId } : {}),
        status: this.reconcileStatus(subscription.status, dto.status),
      };
      const updated = await repos.subscriptions.update(
        subscription.id,
        patch,
        this.deps.tenantId ?? null,
      );
      await repos.subscriptionItems.updateById(
        subscription.id,
        selection.selectedItem.id,
        { priceId },
        this.deps.tenantId ?? null,
      );
      await this.auditWith(repos, {
        action: 'subscription.swapped',
        subscriptionId: subscription.id,
        before: { itemId: selection.selectedItem.id, priceId: selection.selectedItem.priceId },
        after: { itemId: selection.selectedItem.id, priceId },
        authorization,
      });
      return updated;
    });
  }
}
