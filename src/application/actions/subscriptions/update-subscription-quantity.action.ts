import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
import { SubscriptionAction } from './subscription-action';

export class UpdateSubscriptionQuantityAction extends SubscriptionAction {
  constructor(
    deps: BillingDependencies,
    private readonly policy = new CanUpdateSubscriptionPolicy(),
  ) {
    super(deps);
  }

  async handle(
    billable: Billable,
    name: string,
    quantity: number,
    authorization?: AuthorizationContext,
    itemId?: string,
  ): Promise<Subscription> {
    this.authorize(
      (context) => this.policy.authorize(context),
      authorization,
      'update subscription quantity',
    );
    this.assertQuantity(quantity);
    const provider = this.subscriptionProvider('changeQuantity');
    const subscription = await this.resolve(billable, name);
    const selection = await this.selectItem(subscription, itemId);
    const providerItems = selection.items.map((subscriptionItem) => ({
      priceId: subscriptionItem.priceId,
      quantity:
        subscriptionItem.id === selection.selectedItem.id ? quantity : subscriptionItem.quantity,
    }));
    const dto = await provider.updateSubscription(
      {
        providerSubscriptionId: subscription.providerSubscriptionId,
        priceId: selection.selectedItem.priceId,
        quantity,
        providerItemId: selection.selectedItem.providerItemId,
        items: providerItems,
      },
      this.context('quantity', subscription.providerSubscriptionId, String(quantity), true),
    );
    return this.storage().transaction(async (repos) => {
      const patch = {
        ...(selection.items.length === 1 ? { quantity } : {}),
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
        { quantity },
        this.deps.tenantId ?? null,
      );
      await this.auditWith(repos, {
        action: 'subscription.quantity_updated',
        subscriptionId: subscription.id,
        before: { itemId: selection.selectedItem.id, quantity: selection.selectedItem.quantity },
        after: { itemId: selection.selectedItem.id, quantity },
        authorization,
      });
      return updated;
    });
  }
}
