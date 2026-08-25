import type { SubscriptionChangePolicies } from '../../../domain/dtos/subscription-change.dto';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import { SubscriptionChangePreviewError } from '../../../domain/errors/subscription-change-preview.error';
import { encodeSubscriptionMutationIntent } from '../../../domain/internal/subscription-mutation-intent';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
import { type SelectedSubscriptionItem, SubscriptionAction } from './subscription-action';

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
    policies?: SubscriptionChangePolicies,
  ): Promise<Subscription> {
    this.authorize(
      (context) => this.policy.authorize(context),
      authorization,
      'update subscription quantity',
    );
    this.assertQuantity(quantity);
    if (!policies) {
      throw new SubscriptionChangePreviewError(
        'Subscription changes require explicit policies',
        'SUBSCRIPTION_CHANGE_POLICY_REQUIRED',
      );
    }
    const subscription = await this.resolve(billable, name);
    await this.assertNoActiveMigration(subscription.id);
    const provider = this.subscriptionProvider('changeQuantity');
    const selection = await this.selectItem(subscription, itemId);
    const projectSubscriptionQuantity = projectsCanonicalQuantity(subscription, selection);
    const providerItems = selection.items.map((subscriptionItem) => ({
      priceId: subscriptionItem.priceId,
      quantity:
        subscriptionItem.id === selection.selectedItem.id ? quantity : subscriptionItem.quantity,
    }));
    const context = this.context(
      'quantity',
      subscription.providerSubscriptionId,
      String(quantity),
      true,
    );
    return this.mutateSubscription({
      subscriptionId: subscription.id,
      operation: 'subscription_quantity_update',
      context,
      intent: encodeSubscriptionMutationIntent({
        itemId: selection.selectedItem.id,
        source: {
          priceId: selection.selectedItem.priceId,
          quantity: selection.selectedItem.quantity,
        },
        target: { priceId: selection.selectedItem.priceId, quantity },
        projectItem: true,
        projectSubscriptionPrice: false,
        projectSubscriptionQuantity,
      }),
      callProvider: async () => ({
        kind: 'applied',
        value: await provider.updateSubscription(
          {
            providerSubscriptionId: subscription.providerSubscriptionId,
            priceId: selection.selectedItem.priceId,
            quantity,
            providerItemId: selection.selectedItem.providerItemId,
            items: providerItems,
            ...policies,
            calculatedAt: this.deps.clock.now(),
          },
          context,
        ),
      }),
      persist: async (repos, dto) => {
        const patch = {
          ...(projectSubscriptionQuantity
            ? {
                quantity,
                ...(subscription.acceptedQuantity === null ? {} : { acceptedQuantity: quantity }),
              }
            : {}),
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
      },
    });
  }
}

function projectsCanonicalQuantity(
  subscription: Subscription,
  selection: SelectedSubscriptionItem,
): boolean {
  if (selection.items.length === 1) return true;
  const canonicalPrimary = selection.items.filter(
    (item) =>
      item.priceId === subscription.canonicalPriceId &&
      item.quantity === subscription.acceptedQuantity,
  );
  return canonicalPrimary.length === 1 && canonicalPrimary[0]?.id === selection.selectedItem.id;
}
